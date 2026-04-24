import { getSupabaseBrowserClient } from "@/lib/supabase/client"

const BUCKET = "memory-images"
const TTL_SECONDS = 3600
// 실제 만료 60초 전에 캐시 무효화 (약간의 버퍼)
const CACHE_BUFFER_MS = 60_000

const urlCache = new Map<string, { url: string; expiresAt: number }>()
const inFlight = new Map<string, Promise<string>>()

function getApiUrl(path: string) {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "")
  return baseUrl ? `${baseUrl}${path}` : path
}

async function ensureAccessToken() {
  const supabase = getSupabaseBrowserClient()

  let {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.access_token) {
    const { error } = await supabase.auth.signInAnonymously()
    if (error) {
      throw error
    }

    const result = await supabase.auth.getSession()
    session = result.data.session
  }

  if (!session?.access_token) {
    throw new Error("인증에 실패했습니다.")
  }

  return session.access_token
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const token = await ensureAccessToken()
  const headers = new Headers(init?.headers)

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

  headers.set("Authorization", `Bearer ${token}`)

  const response = await fetch(getApiUrl(input), {
    ...init,
    headers,
  })

  if (!response.ok) {
    let message = `요청이 실패했습니다. (${response.status})`

    try {
      const data = (await response.json()) as { error?: string }
      if (typeof data.error === "string" && data.error.trim() !== "") {
        message = data.error
      }
    } catch {
      // JSON 파싱 실패 시 기본 메시지 유지
    }

    throw new Error(message)
  }

  return (await response.json()) as T
}

async function toBase64(file: File) {
  const buffer = await file.arrayBuffer()
  let binary = ""
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }

  return btoa(binary)
}

/**
 * private 버킷에 이미지 업로드.
 * 반환값은 DB의 image_url 컬럼에 저장할 path.
 * 경로 구조: {userId}/{timestamp}-{uuid}.{ext}
 */
export async function uploadImage(file: File): Promise<string> {
  const fileData = await toBase64(file)
  const data = await requestJson<{ path: string }>("/api/storage/images", {
    method: "POST",
    body: JSON.stringify({
      fileName: file.name,
      fileType: file.type,
      fileData,
    }),
  })

  return data.path
}

/**
 * DB에 저장된 path → signed URL (TTL 3600초).
 * - 세션 메모리 캐시로 중복 발급 방지
 * - 동시 요청 dedup (같은 path는 요청 1회만)
 * - force=true 시 캐시 무시 (onError 재시도용)
 */
export function getSignedUrl(path: string, force = false): Promise<string> {
  if (!force) {
    const cached = urlCache.get(path)
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.url)
    const inflight = inFlight.get(path)
    if (inflight) return inflight
  } else {
    urlCache.delete(path)
    inFlight.delete(path)
  }

  const promise = requestJson<{ url: string }>(
    `/api/storage/images/signed-url?${new URLSearchParams({ path }).toString()}`,
  )
    .then(({ url }) => {
      urlCache.set(path, {
        url,
        expiresAt: Date.now() + TTL_SECONDS * 1000 - CACHE_BUFFER_MS,
      })
      inFlight.delete(path)
      return url
    })
    .catch((err) => {
      inFlight.delete(path)
      throw err
    })

  inFlight.set(path, promise)
  return promise
}
