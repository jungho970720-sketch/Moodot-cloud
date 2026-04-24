import { Router } from "express"

import { getSupabaseUserClient } from "../lib/supabase.js"

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
