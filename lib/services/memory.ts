import { getAccessToken } from "@/lib/auth"
import logger from "@/lib/logger"
import type { MemoryMutationInput } from "@/lib/memory-validation"

// ---------- Types ----------

export type MemoryRow = {
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
  processed: boolean | null
}

export type CreateMemoryInput = MemoryMutationInput

export type UpdateMemoryInput = MemoryMutationInput

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
    // 응답 본문이 JSON이 아니어도 기존 흐름 유지
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
  })

  if (!response.ok) {
    throw new Error(await getErrorMessage(response))
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

// ---------- Queries ----------

/** 목록 조회 (memory_at 내림차순). limit/offset 미전달 시 전체 반환. 에러 시 throw. */
export async function getMemories(limit?: number, offset?: number): Promise<MemoryRow[]> {
  if (limit !== undefined) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset ?? 0) })
    return requestJson<MemoryRow[]>(`/api/memories?${params.toString()}`)
  }
  return requestJson<MemoryRow[]>("/api/memories")
}

const RECENT_MEMORIES_TTL_MS = 30_000

type RecentCacheEntry = { data: MemoryRow[]; ts: number }
const _recentMemoriesCache = new Map<string, RecentCacheEntry>()
let _recentMemoriesCacheGen = 0

const _recentMemoriesInflight = new Map<string, Promise<MemoryRow[]>>()

export function invalidateRecentMemoriesCache(limit?: number): void {
  _recentMemoriesCacheGen++
  if (limit !== undefined) {
    _recentMemoriesCache.delete(`recent:${limit}`)
  } else {
    _recentMemoriesCache.clear()
    _recentMemoriesInflight.clear()
  }
}

/** 최신 N개 (memory_at 내림차순). 에러 시 throw. */
export function getRecentMemories(limit: number): Promise<MemoryRow[]> {
  const cacheKey = `recent:${limit}`
  const cached = _recentMemoriesCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < RECENT_MEMORIES_TTL_MS) {
    return Promise.resolve(cached.data)
  }

  const url = `/api/memories?${new URLSearchParams({ limit: String(limit) })}`
  const gen = _recentMemoriesCacheGen
  const inflightKey = `${gen}:${url}`

  const inflight = _recentMemoriesInflight.get(inflightKey)
  if (inflight) return inflight

  const promise = requestJson<MemoryRow[]>(url)
    .then((data) => {
      if (_recentMemoriesCacheGen === gen) {
        _recentMemoriesCache.set(cacheKey, { data, ts: Date.now() })
      }
      return data
    })
    .finally(() => {
      _recentMemoriesInflight.delete(inflightKey)
    })

  _recentMemoriesInflight.set(inflightKey, promise)
  return promise
}

/** 단건 조회. 에러 시 throw. */
export async function getMemoryById(id: number): Promise<MemoryRow> {
  return requestJson<MemoryRow>(`/api/memories/${id}`)
}

// ---------- Mutations ----------

/** 새 메모리 생성. 에러 시 throw. */
export async function createMemory(input: CreateMemoryInput): Promise<number> {
  const data = await requestJson<{ id: number }>("/api/memories", {
    method: "POST",
    body: JSON.stringify(input),
  })

  invalidateRecentMemoriesCache()
  return data.id
}

/** 기존 메모리 수정. 에러 시 throw. */
export async function updateMemory(id: number, input: UpdateMemoryInput): Promise<void> {
  await requestJson<void>(`/api/memories/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })
  invalidateRecentMemoriesCache()
}

/** 메모리 삭제. 에러 시 throw. */
export async function deleteMemory(id: number): Promise<void> {
  await requestJson<void>(`/api/memories/${id}`, {
    method: "DELETE",
  })
  invalidateRecentMemoriesCache()
}
