import { Router } from "express"

import {
  buildMemoryTextMap,
  type MemoryTextDbRow,
} from "../lib/memory-records.js"
import { getSupabaseUserClient } from "../lib/supabase.js"

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
