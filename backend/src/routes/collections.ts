import { Router } from "express"

import {
  buildMemoryTextMap,
  type MemoryTextDbRow,
} from "../lib/memory-records.js"
import { getPostgresPool } from "../lib/postgres.js"
import { getAuthenticatedUser, HttpError } from "../lib/supabase.js"

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

collectionsRouter.get("/", async (request, response, next) => {
  try {
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
  } catch (error) {
    next(error)
  }
})

collectionsRouter.get("/available-memories", async (request, response, next) => {
  try {
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
  } catch (error) {
    next(error)
  }
})

collectionsRouter.get("/:id", async (request, response, next) => {
  try {
    const collectionId = request.params.id
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
  } catch (error) {
    next(error)
  }
})

collectionsRouter.post("/", async (request, response, next) => {
  try {
    const user = await getAuthenticatedUser(request)
    const input = request.body as CollectionFormInput
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
  } catch (error) {
    next(error)
  }
})

collectionsRouter.patch("/:id", async (request, response, next) => {
  try {
    const collectionId = request.params.id
    const user = await getAuthenticatedUser(request)
    const input = request.body as CollectionFormInput
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
  } catch (error) {
    next(error)
  }
})

collectionsRouter.delete("/:id", async (request, response, next) => {
  try {
    const collectionId = request.params.id
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
  } catch (error) {
    next(error)
  }
})
