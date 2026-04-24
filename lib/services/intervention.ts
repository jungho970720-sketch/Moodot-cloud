import { getSupabaseBrowserClient } from "@/lib/supabase/client"

export type Intervention = {
  id: number
  reason: string
  message: string
  status: "pending" | "shown" | "interacted" | "dismissed"
  message_type: "empathy" | "encouragement" | "checkin" | null
  created_at: string
}

type ApiErrorResponse = {
  error?: string
}

function getApiUrl(path: string) {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "")
  return baseUrl ? `${baseUrl}${path}` : path
}

async function getAuthHeaders() {
  const supabase = getSupabaseBrowserClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.access_token) {
    return {}
  }

  return {
    Authorization: `Bearer ${session.access_token}`,
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

export async function getLatestPendingIntervention(): Promise<Intervention | null> {
  try {
    return await requestJson<Intervention | null>("/api/interventions/pending/latest")
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("인증이 필요합니다.") || error.message.includes("(401)"))
    ) {
      return null
    }
    throw error
  }
}

export async function markInterventionAsShown(id: number): Promise<void> {
  await requestJson<void>(`/api/interventions/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "shown" }),
  })
}

export async function markInterventionAsInteracted(id: number): Promise<void> {
  await requestJson<void>(`/api/interventions/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "interacted" }),
  })
}

export async function submitFeedback(
  interventionId: number,
  explicitScore: 2 | -2,
): Promise<void> {
  await requestJson<void>(`/api/interventions/${interventionId}/feedback`, {
    method: "POST",
    body: JSON.stringify({ explicitScore }),
  })
}
