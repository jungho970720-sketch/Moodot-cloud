import { Router } from "express"

import {
  buildMemoryTextMap,
  type MemoryTextDbRow,
} from "../lib/memory-records.js"
import { getPostgresPool, hasPostgresConfig } from "../lib/postgres.js"
import { getAuthenticatedUser, getSupabaseUserClient, HttpError } from "../lib/supabase.js"

type CoverMemory = { image_url: string | null } | null

type CollectionRow = {
  id: string
  title: string
  note: string | null
  location: string | null
  start_date: string | null
  end_date: string | null
  cover_memory_id: number | null
  created_at: string
  updated_at: string
}

type MemoryRow = {
  id: number
  title: string | null
  text: string | null
  image_url: string | null
  emotion_id: number | null
  with_whom: string | null
  memory_at: string | null
  place_name: string | null
  location_label: string | null
  location_lat: number | null
  location_lng: number | null
}

type CollectionSummary = CollectionRow & {
  cover_memory: CoverMemory
  memory_count: number
}

type MemoryInCollection = MemoryRow & { position: number }

type CollectionWithMemories = CollectionRow & {
  cover_memory: CoverMemory
  memories: MemoryInCollection[]
}

type CollectionFormInput = {
  title: string
  note: string | null
  location: string | null
  start_date: string | null
  end_date: string | null
  cover_memory_id: number | null
  memory_ids: number[]
}

type CollectionListRow = CollectionRow & {
  cover_memory: CoverMemory
  collection_memories: Array<{ count: number }>
}

type CollectionDetailRow = CollectionRow & {
  cover_memory: CoverMemory
}

type CollectionMemoryJoinRow = {
  position: number
  memories: Omit<MemoryRow, "text"> | Omit<MemoryRow, "text">[]
}

export const collectionsRouter = Router()

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

function toCoverMemory(imageUrl: string | null | undefined): CoverMemory {
  return imageUrl == null ? null : { image_url: imageUrl }
}

function toMemoryRow(row: MemoryRow & MemoryTextDbRow): MemoryRow {
  const textMap = buildMemoryTextMap([row])
  return {
    id: row.id,
    title: row.title,
    text: textMap[row.id] ?? null,
    image_url: row.image_url,
    emotion_id: row.emotion_id,
    with_whom: row.with_whom,
    memory_at: row.memory_at,
    place_name: row.place_name,
    location_label: row.location_label,
    location_lat: row.location_lat,
    location_lng: row.location_lng,
  }
}

async function assertUserMemories(userId: string, memoryIds: number[]) {
  if (memoryIds.length === 0) return

  const uniqueIds = [...new Set(memoryIds)]
  const { rows } = await getPostgresPool().query<{ count: number }>(
    `
      select count(*)::int as count
      from public.memories
      where user_id = $1
        and id = any($2::bigint[])
    `,
    [userId, uniqueIds],
  )

  if ((rows[0]?.count ?? 0) !== uniqueIds.length) {
    throw new HttpError("컬렉션에 추가할 수 없는 기록이 포함되어 있습니다.", 400)
  }
}

async function fetchMemoryTexts(
  userId: string,
  ids: number[],
  queryClient: Awaited<ReturnType<typeof getSupabaseUserClient>>["supabase"],
) {
  if (ids.length === 0) return {}

  const { data, error } = await queryClient
    .from("memories")
    .select("id,text,text_ciphertext,text_iv,text_key_version")
    .eq("user_id", userId)
    .in("id", ids)

  if (error) throw error

  return buildMemoryTextMap((data ?? []) as MemoryTextDbRow[])
}

collectionsRouter.get("/", async (request, response, next) => {
  try {
    if (hasPostgresConfig()) {
      const user = await getAuthenticatedUser(request)
      const { rows } = await getPostgresPool().query<
        CollectionRow & { cover_image_url: string | null; memory_count: number }
      >(
        `
          select
            c.id,
            c.title,
            c.note,
            c.location,
            c.start_date,
            c.end_date,
            c.cover_memory_id,
            c.created_at,
            c.updated_at,
            cover.image_url as cover_image_url,
            count(cm.memory_id)::int as memory_count
          from public.collections c
          left join public.memories cover
            on cover.id = c.cover_memory_id
            and cover.user_id = c.user_id
          left join public.collection_memories cm
            on cm.collection_id = c.id
          where c.user_id = $1
          group by c.id, cover.image_url
          order by c.created_at desc
        `,
        [user.id],
      )

      const result: CollectionSummary[] = rows.map(({ cover_image_url, memory_count, ...row }) => ({
        ...row,
        cover_memory: toCoverMemory(cover_image_url),
        memory_count,
      }))

      response.json(result)
      return
    }

    const { supabase, user } = await getSupabaseUserClient(request)
    const { data, error } = await supabase
      .from("collections")
      .select("*, collection_memories(count), cover_memory:cover_memory_id(image_url)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })

    if (error) throw error

    const rows = (data ?? []) as CollectionListRow[]
    const result: CollectionSummary[] = rows.map((row) => ({
      id: row.id,
      title: row.title,
      note: row.note,
      location: row.location,
      start_date: row.start_date,
      end_date: row.end_date,
      cover_memory_id: row.cover_memory_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      cover_memory: row.cover_memory ?? null,
      memory_count: Number(row.collection_memories?.[0]?.count ?? 0),
    }))

    response.json(result)
  } catch (error) {
    next(error)
  }
})

collectionsRouter.get("/available-memories", async (request, response, next) => {
  try {
    if (hasPostgresConfig()) {
      const user = await getAuthenticatedUser(request)
      const currentCollectionId =
        typeof request.query.currentCollectionId === "string"
          ? request.query.currentCollectionId
          : null

      const { rows } = await getPostgresPool().query<MemoryRow & MemoryTextDbRow>(
        `
          select ${MEMORY_SQL_COLUMNS}
          from public.memories m
          where m.user_id = $1
            and not exists (
              select 1
              from public.collection_memories cm
              join public.collections c on c.id = cm.collection_id
              where cm.memory_id = m.id
                and c.user_id = $1
                and ($2::uuid is null or c.id <> $2::uuid)
            )
          order by m.memory_at desc nulls last, m.id desc
        `,
        [user.id, currentCollectionId],
      )

      response.json(rows.map(toMemoryRow))
      return
    }

    const { supabase, user } = await getSupabaseUserClient(request)
    const currentCollectionId =
      typeof request.query.currentCollectionId === "string"
        ? request.query.currentCollectionId
        : undefined

    const { data: userCollections, error: userCollectionsError } = await supabase
      .from("collections")
      .select("id")
      .eq("user_id", user.id)

    if (userCollectionsError) throw userCollectionsError

    const collectionIds = (userCollections ?? []).map((collection) => collection.id as string)

    let excludedIds: number[] = []

    if (collectionIds.length > 0) {
      const { data: taken, error: takenError } = await supabase
        .from("collection_memories")
        .select("memory_id, collection_id")
        .in("collection_id", collectionIds)

      if (takenError) throw takenError

      excludedIds = (taken ?? [])
        .filter(
          (collectionMemory) =>
            currentCollectionId == null || collectionMemory.collection_id !== currentCollectionId,
        )
        .map((collectionMemory) => Number(collectionMemory.memory_id))
        .filter((id) => Number.isInteger(id) && id > 0)
    }

    const { data: memories, error: memoriesError } = await supabase
      .from("memories")
      .select(
        "id,title,image_url,emotion_id,with_whom,memory_at,place_name,location_label,location_lat,location_lng",
      )
      .eq("user_id", user.id)
      .order("memory_at", { ascending: false })

    if (memoriesError) throw memoriesError

    const bases = (memories ?? []) as Omit<MemoryRow, "text">[]
    const textMap = await fetchMemoryTexts(
      user.id,
      bases.map((memory) => memory.id),
      supabase,
    )

    const all: MemoryRow[] = bases.map((memory) => ({
      ...memory,
      text: textMap[memory.id] ?? null,
    }))

    if (excludedIds.length === 0) {
      response.json(all)
      return
    }

    response.json(all.filter((memory) => !excludedIds.includes(memory.id)))
  } catch (error) {
    next(error)
  }
})

collectionsRouter.get("/:id", async (request, response, next) => {
  try {
    const collectionId = request.params.id

    if (hasPostgresConfig()) {
      const user = await getAuthenticatedUser(request)
      const { rows } = await getPostgresPool().query<
        CollectionRow & { cover_image_url: string | null }
      >(
        `
          select
            c.id,
            c.title,
            c.note,
            c.location,
            c.start_date,
            c.end_date,
            c.cover_memory_id,
            c.created_at,
            c.updated_at,
            cover.image_url as cover_image_url
          from public.collections c
          left join public.memories cover
            on cover.id = c.cover_memory_id
            and cover.user_id = c.user_id
          where c.id = $1
            and c.user_id = $2
        `,
        [collectionId, user.id],
      )

      const collection = rows[0]
      if (!collection) {
        throw new HttpError("컬렉션을 찾을 수 없습니다.", 404)
      }

      const { rows: memoryRows } = await getPostgresPool().query<
        MemoryRow & MemoryTextDbRow & { position: number }
      >(
        `
          select
            cm.position,
            ${MEMORY_SQL_COLUMNS.split("\n").map((line) => {
              const trimmed = line.trim()
              return trimmed === "" ? "" : `m.${trimmed}`
            }).join("\n")}
          from public.collection_memories cm
          join public.memories m on m.id = cm.memory_id
          where cm.collection_id = $1
            and m.user_id = $2
          order by cm.position asc
        `,
        [collectionId, user.id],
      )

      const { cover_image_url, ...rest } = collection
      const result: CollectionWithMemories = {
        ...rest,
        cover_memory: toCoverMemory(cover_image_url),
        memories: memoryRows.map((row) => ({
          ...toMemoryRow(row),
          position: row.position,
        })),
      }

      response.json(result)
      return
    }

    const { supabase, user } = await getSupabaseUserClient(request)

    const { data: row, error: collectionError } = await supabase
      .from("collections")
      .select("*, cover_memory:cover_memory_id(image_url)")
      .eq("id", collectionId)
      .eq("user_id", user.id)
      .single()

    if (collectionError) throw collectionError

    const { data: joins, error: joinsError } = await supabase
      .from("collection_memories")
      .select(
        "position, memories(id, title, image_url, emotion_id, with_whom, memory_at, place_name, location_label, location_lat, location_lng)",
      )
      .eq("collection_id", collectionId)
      .order("position", { ascending: true })

    if (joinsError) throw joinsError

    const memoryBases = ((joins ?? []) as CollectionMemoryJoinRow[]).map((join) => {
      const memory = Array.isArray(join.memories) ? join.memories[0] : join.memories
      return { ...memory, position: join.position }
    })

    const textMap = await fetchMemoryTexts(
      user.id,
      memoryBases.map((memory) => memory.id),
      supabase,
    )

    const memories: MemoryInCollection[] = memoryBases.map((memory) => ({
      ...memory,
      text: textMap[memory.id] ?? null,
    }))

    const { cover_memory, ...rest } = row as CollectionDetailRow
    const result: CollectionWithMemories = {
      ...rest,
      cover_memory: cover_memory ?? null,
      memories,
    }

    response.json(result)
  } catch (error) {
    next(error)
  }
})

collectionsRouter.post("/", async (request, response, next) => {
  try {
    const input = request.body as CollectionFormInput

    if (hasPostgresConfig()) {
      const user = await getAuthenticatedUser(request)
      const client = await getPostgresPool().connect()

      try {
        await assertUserMemories(
          user.id,
          [
            ...input.memory_ids,
            ...(input.cover_memory_id == null ? [] : [input.cover_memory_id]),
          ],
        )

        await client.query("begin")
        const { rows } = await client.query<{ id: string }>(
          `
            insert into public.collections (
              title,
              note,
              location,
              start_date,
              end_date,
              cover_memory_id,
              user_id
            )
            values ($1, $2, $3, $4, $5, $6, $7)
            returning id
          `,
          [
            input.title,
            input.note,
            input.location,
            input.start_date,
            input.end_date,
            input.cover_memory_id,
            user.id,
          ],
        )

        const createdId = rows[0]?.id
        if (!createdId) {
          throw new Error("컬렉션 생성 결과를 확인할 수 없습니다.")
        }

        if (input.memory_ids.length > 0) {
          await client.query(
            `
              insert into public.collection_memories (
                collection_id,
                memory_id,
                position
              )
              select $1::uuid, memory_id, position
              from unnest($2::bigint[], $3::int[]) as input(memory_id, position)
            `,
            [
              createdId,
              input.memory_ids,
              input.memory_ids.map((_, index) => index),
            ],
          )
        }

        await client.query("commit")
        response.json({ id: createdId })
      } catch (error) {
        await client.query("rollback").catch(() => undefined)
        throw error
      } finally {
        client.release()
      }

      return
    }

    const { supabase, user } = await getSupabaseUserClient(request)

    const { data, error } = await supabase
      .from("collections")
      .insert({
        title: input.title,
        note: input.note,
        location: input.location,
        start_date: input.start_date,
        end_date: input.end_date,
        cover_memory_id: input.cover_memory_id,
        user_id: user.id,
      })
      .select("id")
      .single()

    if (error) throw error

    const createdId = (data as { id: string }).id

    if (input.memory_ids.length > 0) {
      const { error: insertError } = await supabase.from("collection_memories").insert(
        input.memory_ids.map((memoryId, index) => ({
          collection_id: createdId,
          memory_id: memoryId,
          position: index,
        })),
      )

      if (insertError) throw insertError
    }

    response.json({ id: createdId })
  } catch (error) {
    next(error)
  }
})

collectionsRouter.patch("/:id", async (request, response, next) => {
  try {
    const collectionId = request.params.id
    const input = request.body as CollectionFormInput

    if (hasPostgresConfig()) {
      const user = await getAuthenticatedUser(request)
      const client = await getPostgresPool().connect()

      try {
        await assertUserMemories(
          user.id,
          [
            ...input.memory_ids,
            ...(input.cover_memory_id == null ? [] : [input.cover_memory_id]),
          ],
        )

        await client.query("begin")
        const { rowCount } = await client.query(
          `
            update public.collections
            set
              title = $1,
              note = $2,
              location = $3,
              start_date = $4,
              end_date = $5,
              cover_memory_id = $6,
              updated_at = now()
            where id = $7
              and user_id = $8
          `,
          [
            input.title,
            input.note,
            input.location,
            input.start_date,
            input.end_date,
            input.cover_memory_id,
            collectionId,
            user.id,
          ],
        )

        if (rowCount === 0) {
          throw new HttpError("컬렉션을 찾을 수 없습니다.", 404)
        }

        await client.query("delete from public.collection_memories where collection_id = $1", [
          collectionId,
        ])

        if (input.memory_ids.length > 0) {
          await client.query(
            `
              insert into public.collection_memories (
                collection_id,
                memory_id,
                position
              )
              select $1::uuid, memory_id, position
              from unnest($2::bigint[], $3::int[]) as input(memory_id, position)
            `,
            [
              collectionId,
              input.memory_ids,
              input.memory_ids.map((_, index) => index),
            ],
          )
        }

        await client.query("commit")
        response.status(204).send()
      } catch (error) {
        await client.query("rollback").catch(() => undefined)
        throw error
      } finally {
        client.release()
      }

      return
    }

    const { supabase, user } = await getSupabaseUserClient(request)

    const { error } = await supabase
      .from("collections")
      .update({
        title: input.title,
        note: input.note,
        location: input.location,
        start_date: input.start_date,
        end_date: input.end_date,
        cover_memory_id: input.cover_memory_id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", collectionId)
      .eq("user_id", user.id)

    if (error) throw error

    const { error: deleteError } = await supabase
      .from("collection_memories")
      .delete()
      .eq("collection_id", collectionId)

    if (deleteError) throw deleteError

    if (input.memory_ids.length > 0) {
      const { error: insertError } = await supabase.from("collection_memories").insert(
        input.memory_ids.map((memoryId, index) => ({
          collection_id: collectionId,
          memory_id: memoryId,
          position: index,
        })),
      )

      if (insertError) throw insertError
    }

    response.status(204).send()
  } catch (error) {
    next(error)
  }
})

collectionsRouter.delete("/:id", async (request, response, next) => {
  try {
    const collectionId = request.params.id

    if (hasPostgresConfig()) {
      const user = await getAuthenticatedUser(request)
      const { rowCount } = await getPostgresPool().query(
        `
          delete from public.collections
          where id = $1
            and user_id = $2
        `,
        [collectionId, user.id],
      )

      if (rowCount === 0) {
        throw new HttpError("컬렉션을 찾을 수 없습니다.", 404)
      }

      response.status(204).send()
      return
    }

    const { supabase, user } = await getSupabaseUserClient(request)

    const { error } = await supabase
      .from("collections")
      .delete()
      .eq("id", collectionId)
      .eq("user_id", user.id)

    if (error) throw error

    response.status(204).send()
  } catch (error) {
    next(error)
  }
})
