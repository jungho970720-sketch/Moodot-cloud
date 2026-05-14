import { Router } from "express"

import {
  buildMemoryTextMap,
  MEMORY_SELECT_COLUMNS,
  toPublicMemoryRow,
  type MemoryDbRow,
  type MemoryTextDbRow,
} from "../lib/memory-records.js"
import { encryptMemoryText } from "../lib/memory-text-crypto.js"
import { getPostgresPool, hasPostgresConfig } from "../lib/postgres.js"
import { getAuthenticatedUser, getSupabaseUserClient } from "../lib/supabase.js"

type CreateMemoryInput = {
  title: string | null
  text: string | null
  image_url: string | null
  emotion_id: number
  with_whom: string
  memory_at: string
  location_lat: number | null
  location_lng: number | null
  location_label: string | null
  place_name: string | null
}

type UpdateMemoryInput = CreateMemoryInput

type MemoryTextsRequest = {
  ids?: number[]
}

export const memoriesRouter = Router()

const MEMORY_SQL_COLUMNS = `
  id,
  title,
  text,
  text_ciphertext,
  text_iv,
  text_key_version,
  image_url,
  emotion_id,
  with_whom,
  memory_at,
  place_name,
  location_label,
  location_lat,
  location_lng
`

function parseMemoryId(rawId: string) {
  const id = Number(rawId)
  return Number.isInteger(id) && id > 0 ? id : null
}

function buildCreatePayload(input: CreateMemoryInput, userId: string) {
  const encryptedText = encryptMemoryText(input.text)

  return {
    ...input,
    user_id: userId,
    text: null,
    ...encryptedText,
  }
}

function buildUpdatePayload(input: UpdateMemoryInput) {
  const encryptedText = encryptMemoryText(input.text)

  return {
    ...input,
    text: null,
    ...encryptedText,
  }
}

function buildMemoryValues(input: CreateMemoryInput | UpdateMemoryInput) {
  const encryptedText = encryptMemoryText(input.text)

  return [
    input.title,
    null,
    input.image_url,
    input.emotion_id,
    input.with_whom,
    input.memory_at,
    input.location_lat,
    input.location_lng,
    input.location_label,
    input.place_name,
    encryptedText.text_ciphertext,
    encryptedText.text_iv,
    encryptedText.text_key_version,
  ]
}

memoriesRouter.get("/", async (request, response, next) => {
  try {
    if (hasPostgresConfig()) {
      const user = await getAuthenticatedUser(request)
      const limitParam = typeof request.query.limit === "string" ? request.query.limit : null
      const offsetParam = typeof request.query.offset === "string" ? request.query.offset : null
      const values: Array<string | number> = [user.id]
      let pagingClause = ""

      if (limitParam) {
        const limit = Number.parseInt(limitParam, 10)
        const offset = offsetParam ? Math.max(0, Number.parseInt(offsetParam, 10)) : 0
        if (Number.isFinite(limit) && limit > 0) {
          values.push(limit, offset)
          pagingClause = `limit $${values.length - 1} offset $${values.length}`
        }
      }

      const { rows } = await getPostgresPool().query<MemoryDbRow>(
        `
          select ${MEMORY_SQL_COLUMNS}
          from public.memories
          where user_id = $1
          order by memory_at desc nulls last, id desc
          ${pagingClause}
        `,
        values,
      )

      response.setHeader("Cache-Control", "private, max-age=30")
      response.json(rows.map(toPublicMemoryRow))
      return
    }

    const { supabase, user } = await getSupabaseUserClient(request)
    const limitParam = typeof request.query.limit === "string" ? request.query.limit : null
    const offsetParam = typeof request.query.offset === "string" ? request.query.offset : null

    let query = supabase
      .from("memories")
      .select(MEMORY_SELECT_COLUMNS)
      .eq("user_id", user.id)
      .order("memory_at", { ascending: false })

    if (limitParam) {
      const limit = Number.parseInt(limitParam, 10)
      const offset = offsetParam ? Math.max(0, Number.parseInt(offsetParam, 10)) : 0
      if (Number.isFinite(limit) && limit > 0) {
        query = query.range(offset, offset + limit - 1)
      }
    }

    const { data, error } = await query
    if (error) throw error

    response.setHeader("Cache-Control", "private, max-age=30")
    response.json(((data ?? []) as MemoryDbRow[]).map(toPublicMemoryRow))
  } catch (error) {
    next(error)
  }
})

memoriesRouter.post("/", async (request, response, next) => {
  try {
    const input = request.body as CreateMemoryInput

    if (hasPostgresConfig()) {
      const user = await getAuthenticatedUser(request)
      const { rows } = await getPostgresPool().query<{ id: number }>(
        `
          insert into public.memories (
            user_id,
            title,
            text,
            image_url,
            emotion_id,
            with_whom,
            memory_at,
            location_lat,
            location_lng,
            location_label,
            place_name,
            text_ciphertext,
            text_iv,
            text_key_version
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          returning id
        `,
        [user.id, ...buildMemoryValues(input)],
      )

      response.json({ id: rows[0]?.id })
      return
    }

    const { supabase, user } = await getSupabaseUserClient(request)

    const { data, error } = await supabase
      .from("memories")
      .insert(buildCreatePayload(input, user.id) as never)
      .select("id")
      .single()

    if (error) throw error

    response.json({ id: (data as { id: number }).id })
  } catch (error) {
    next(error)
  }
})

memoriesRouter.post("/texts", async (request, response, next) => {
  try {
    const body = request.body as MemoryTextsRequest
    const ids = Array.from(
      new Set(
        (body.ids ?? [])
          .map((id) => Number(id))
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    )

    if (ids.length === 0) {
      response.json({ texts: {} })
      return
    }

    if (hasPostgresConfig()) {
      const user = await getAuthenticatedUser(request)
      const { rows } = await getPostgresPool().query<MemoryTextDbRow>(
        `
          select id, text, text_ciphertext, text_iv, text_key_version
          from public.memories
          where user_id = $1
            and id = any($2::bigint[])
        `,
        [user.id, ids],
      )

      response.json({
        texts: buildMemoryTextMap(rows),
      })
      return
    }

    const { supabase, user } = await getSupabaseUserClient(request)
    const { data, error } = await supabase
      .from("memories")
      .select("id,text,text_ciphertext,text_iv,text_key_version")
      .eq("user_id", user.id)
      .in("id", ids)

    if (error) throw error

    response.json({
      texts: buildMemoryTextMap((data ?? []) as MemoryTextDbRow[]),
    })
  } catch (error) {
    next(error)
  }
})

memoriesRouter.get("/:id", async (request, response, next) => {
  try {
    const memoryId = parseMemoryId(request.params.id)

    if (!memoryId) {
      response.status(400).json({ error: "잘못된 메모리 ID입니다." })
      return
    }

    if (hasPostgresConfig()) {
      const user = await getAuthenticatedUser(request)
      const { rows } = await getPostgresPool().query<MemoryDbRow>(
        `
          select ${MEMORY_SQL_COLUMNS}
          from public.memories
          where id = $1
            and user_id = $2
          limit 1
        `,
        [memoryId, user.id],
      )

      const row = rows[0]
      if (!row) {
        response.status(404).json({ error: "기록을 찾을 수 없습니다." })
        return
      }

      response.setHeader("Cache-Control", "private, max-age=30")
      response.json(toPublicMemoryRow(row))
      return
    }

    const { supabase, user } = await getSupabaseUserClient(request)
    const { data, error } = await supabase
      .from("memories")
      .select(MEMORY_SELECT_COLUMNS)
      .eq("id", memoryId)
      .eq("user_id", user.id)
      .single()

    if (error) {
      if (error.code === "PGRST116") {
        response.status(404).json({ error: "기록을 찾을 수 없습니다." })
        return
      }
      throw error
    }

    response.setHeader("Cache-Control", "private, max-age=30")
    response.json(toPublicMemoryRow(data as MemoryDbRow))
  } catch (error) {
    next(error)
  }
})

memoriesRouter.patch("/:id", async (request, response, next) => {
  try {
    const memoryId = parseMemoryId(request.params.id)

    if (!memoryId) {
      response.status(400).json({ error: "잘못된 메모리 ID입니다." })
      return
    }

    const input = request.body as UpdateMemoryInput

    if (hasPostgresConfig()) {
      const user = await getAuthenticatedUser(request)
      await getPostgresPool().query(
        `
          update public.memories
          set
            title = $3,
            text = $4,
            image_url = $5,
            emotion_id = $6,
            with_whom = $7,
            memory_at = $8,
            location_lat = $9,
            location_lng = $10,
            location_label = $11,
            place_name = $12,
            text_ciphertext = $13,
            text_iv = $14,
            text_key_version = $15
          where id = $1
            and user_id = $2
        `,
        [memoryId, user.id, ...buildMemoryValues(input)],
      )

      response.status(204).send()
      return
    }

    const { supabase, user } = await getSupabaseUserClient(request)
    const { error } = await supabase
      .from("memories")
      .update(buildUpdatePayload(input) as never)
      .eq("id", memoryId)
      .eq("user_id", user.id)

    if (error) throw error

    response.status(204).send()
  } catch (error) {
    next(error)
  }
})

memoriesRouter.delete("/:id", async (request, response, next) => {
  try {
    const memoryId = parseMemoryId(request.params.id)

    if (!memoryId) {
      response.status(400).json({ error: "잘못된 메모리 ID입니다." })
      return
    }

    if (hasPostgresConfig()) {
      const user = await getAuthenticatedUser(request)
      await getPostgresPool().query(
        `
          delete from public.memories
          where id = $1
            and user_id = $2
        `,
        [memoryId, user.id],
      )

      response.status(204).send()
      return
    }

    const { supabase, user } = await getSupabaseUserClient(request)
    const { error } = await supabase
      .from("memories")
      .delete()
      .eq("id", memoryId)
      .eq("user_id", user.id)

    if (error) throw error

    response.status(204).send()
  } catch (error) {
    next(error)
  }
})
