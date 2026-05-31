import { getAccessToken } from "@/lib/auth"
import type { MemoryRow } from "./memory"

export type CoverMemory = { image_url: string | null } | null

export type CollectionRow = {
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

export type CollectionSummary = CollectionRow & {
  cover_memory: CoverMemory
  memory_count: number
}

export type MemoryInCollection = MemoryRow & { position: number }

export type CollectionWithMemories = CollectionRow & {
  cover_memory: CoverMemory
  memories: MemoryInCollection[]
}

export type CollectionFormInput = {
  title: string
  note: string | null
  location: string | null
  start_date: string | null
  end_date: string | null
  cover_memory_id: number | null
  memory_ids: number[]
}

type ApiErrorResponse = {
  error?: string
}

function getApiUrl(path: string) {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "")
  return baseUrl ? `${baseUrl}${path}` : path
}

async function getAuthHeaders() {
  const accessToken = await getAccessToken()

  if (!accessToken) {
    return {}
  }

  return {
    Authorization: `Bearer ${accessToken}`,
  }
}

async function getErrorMessage(response: Response) {
  try {
    const data = (await response.json()) as ApiErrorResponse
    if (typeof data.error === "string" && data.error.trim() !== "") {
      return data.error
    }
  } catch {
    // ignore
  }

  return `요청이 실패했습니다. (${response.status})`
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

  const authHeaders = await getAuthHeaders()
  Object.entries(authHeaders).forEach(([key, value]) => {
    if (!headers.has(key)) {
      headers.set(key, value)
    }
  })

  const response = await fetch(getApiUrl(input), {
    ...init,
    headers,
    cache: "no-store",
  })

  if (!response.ok) {
    throw new Error(await getErrorMessage(response))
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

export async function getCollections(): Promise<CollectionSummary[]> {
  return requestJson<CollectionSummary[]>("/api/collections")
}

export async function getCollectionById(id: string): Promise<CollectionWithMemories> {
  return requestJson<CollectionWithMemories>(`/api/collections/${id}`)
}

export async function getAvailableMemories(currentCollectionId?: string): Promise<MemoryRow[]> {
  const query = currentCollectionId
    ? `?currentCollectionId=${encodeURIComponent(currentCollectionId)}`
    : ""
  return requestJson<MemoryRow[]>(`/api/collections/available-memories${query}`)
}

export async function createCollection(input: CollectionFormInput): Promise<string> {
  const data = await requestJson<{ id: string }>("/api/collections", {
    method: "POST",
    body: JSON.stringify(input),
  })

  return data.id
}

export async function updateCollection(id: string, input: CollectionFormInput): Promise<void> {
  await requestJson<void>(`/api/collections/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })
}

export async function deleteCollection(id: string): Promise<void> {
  await requestJson<void>(`/api/collections/${id}`, {
    method: "DELETE",
  })
}
