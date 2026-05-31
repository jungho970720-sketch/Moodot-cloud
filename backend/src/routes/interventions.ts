import { Router } from "express"

import { getPostgresPool, hasPostgresConfig } from "../lib/postgres.js"
import { getAuthenticatedUser, getSupabaseUserClient, HttpError } from "../lib/supabase.js"

type Intervention = {
  id: number
  reason: string
  message: string
  status: "pending" | "shown" | "interacted" | "dismissed"
  message_type: "empathy" | "encouragement" | "checkin" | null
  created_at: string
}

type FeedbackInput = {
  explicitScore: 2 | -2
}

export const interventionsRouter = Router()

interventionsRouter.get("/insight-state", async (request, response, next) => {
  try {
    if (hasPostgresConfig()) {
      const user = await getAuthenticatedUser(request)
      const pool = getPostgresPool()
      const [interventionsResult, latestByCreatedResult, latestByMemoryAtResult] =
        await Promise.all([
          pool.query<Intervention>(
            `
              select id, reason, message, status, message_type, created_at
              from public.interventions
              where status = 'pending'
                and user_id = $1
              order by created_at desc
              limit 1
            `,
            [user.id],
          ),
          pool.query<{ processed: boolean | null }>(
            `
              select processed
              from public.memories
              where user_id = $1
              order by created_at desc
              limit 1
            `,
            [user.id],
          ),
          pool.query<{ emotion_id: number | null }>(
            `
              select emotion_id
              from public.memories
              where user_id = $1
              order by memory_at desc nulls last, id desc
              limit 1
            `,
            [user.id],
          ),
        ])

      response.json({
        intervention: interventionsResult.rows[0] ?? null,
        hasUnprocessedLatestMemory: latestByCreatedResult.rows[0]?.processed === false,
        latestEmotionId: latestByMemoryAtResult.rows[0]?.emotion_id ?? null,
      })
      return
    }

    const { supabase, user } = await getSupabaseUserClient(request)

    const [{ data: interventions, error: interventionsError }, { data: latestByCreated, error: latestByCreatedError }, { data: latestByMemoryAt, error: latestByMemoryAtError }] =
      await Promise.all([
        supabase
          .from("interventions")
          .select("*")
          .eq("status", "pending")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1),
        supabase
          .from("memories")
          .select("processed")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1),
        supabase
          .from("memories")
          .select("emotion_id")
          .eq("user_id", user.id)
          .order("memory_at", { ascending: false })
          .limit(1),
      ])

    if (interventionsError) throw interventionsError
    if (latestByCreatedError) throw latestByCreatedError
    if (latestByMemoryAtError) throw latestByMemoryAtError

    const intervention =
      interventions && interventions.length > 0
        ? (interventions[0] as Intervention)
        : null

    const hasUnprocessedLatestMemory = Boolean(
      latestByCreated &&
        latestByCreated.length > 0 &&
        latestByCreated[0]?.processed === false,
    )

    const latestEmotionId =
      latestByMemoryAt && latestByMemoryAt.length > 0
        ? (latestByMemoryAt[0]?.emotion_id ?? null)
        : null

    response.json({
      intervention,
      hasUnprocessedLatestMemory,
      latestEmotionId,
    })
  } catch (error) {
    next(error)
  }
})

interventionsRouter.get("/pending/latest", async (request, response, next) => {
  try {
    if (hasPostgresConfig()) {
      const user = await getAuthenticatedUser(request)
      const { rows } = await getPostgresPool().query<Intervention>(
        `
          select id, reason, message, status, message_type, created_at
          from public.interventions
          where status = 'pending'
            and user_id = $1
          order by created_at desc
          limit 1
        `,
        [user.id],
      )

      response.json(rows[0] ?? null)
      return
    }

    const { supabase, user } = await getSupabaseUserClient(request)

    const { data, error } = await supabase
      .from("interventions")
      .select("*")
      .eq("status", "pending")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)

    if (error) throw error

    if (!data || data.length === 0) {
      response.json(null)
      return
    }

    response.json(data[0] as Intervention)
  } catch (error) {
    next(error)
  }
})

interventionsRouter.patch("/:id/status", async (request, response, next) => {
  try {
    const interventionId = Number(request.params.id)
    const status = request.body?.status as "shown" | "interacted" | undefined

    if (!Number.isInteger(interventionId) || interventionId <= 0) {
      response.status(400).json({ error: "잘못된 intervention id 입니다." })
      return
    }

    if (status !== "shown" && status !== "interacted") {
      response.status(400).json({ error: "지원하지 않는 status 입니다." })
      return
    }

    if (hasPostgresConfig()) {
      const user = await getAuthenticatedUser(request)
      const { rowCount } = await getPostgresPool().query(
        `
          update public.interventions
          set status = $1
          where id = $2
            and user_id = $3
        `,
        [status, interventionId, user.id],
      )

      if (rowCount === 0) {
        throw new HttpError("대상 intervention을 찾을 수 없습니다.", 404)
      }

      response.status(204).send()
      return
    }

    const { supabase, user } = await getSupabaseUserClient(request)
    const { error } = await supabase
      .from("interventions")
      .update({ status })
      .eq("id", interventionId)
      .eq("user_id", user.id)

    if (error) throw error

    response.status(204).send()
  } catch (error) {
    next(error)
  }
})

interventionsRouter.post("/:id/feedback", async (request, response, next) => {
  try {
    const interventionId = Number(request.params.id)
    const { explicitScore } = request.body as FeedbackInput

    if (!Number.isInteger(interventionId) || interventionId <= 0) {
      response.status(400).json({ error: "잘못된 intervention id 입니다." })
      return
    }

    if (explicitScore !== 2 && explicitScore !== -2) {
      response.status(400).json({ error: "잘못된 explicitScore 입니다." })
      return
    }

    if (hasPostgresConfig()) {
      const user = await getAuthenticatedUser(request)
      const { rowCount } = await getPostgresPool().query(
        `
          insert into public.intervention_feedback (
            intervention_id,
            user_id,
            explicit_score
          )
          select id, $2, $3
          from public.interventions
          where id = $1
            and user_id = $2
        `,
        [interventionId, user.id, explicitScore],
      )

      if (rowCount === 0) {
        throw new HttpError("대상 intervention을 찾을 수 없습니다.", 404)
      }

      response.status(204).send()
      return
    }

    const { supabase, user } = await getSupabaseUserClient(request)
    const { error } = await supabase
      .from("intervention_feedback")
      .insert({
        intervention_id: interventionId,
        user_id: user.id,
        explicit_score: explicitScore,
      })

    if (error) throw error

    response.status(204).send()
  } catch (error) {
    next(error)
  }
})
