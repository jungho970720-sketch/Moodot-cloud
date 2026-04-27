import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import type { User } from "@supabase/supabase-js"

function getApiUrl(path: string) {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "")
  return baseUrl ? `${baseUrl}${path}` : path
}

async function getAccessToken() {
  const supabase = getSupabaseBrowserClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  return session?.access_token ?? null
}

export async function signInAnonymously() {
  const supabase = getSupabaseBrowserClient()
  const { error } = await supabase.auth.signInAnonymously()
  if (error) console.error("[auth] signInAnonymously error:", error)
}

export async function signInWithGoogle() {
  const supabase = getSupabaseBrowserClient()
  const redirectTo = `${window.location.origin}/auth/callback`

  const { data: { user } } = await supabase.auth.getUser()

  console.debug(
    "[auth] signInWithGoogle | user.id:", user?.id ?? "null",
    "| is_anonymous:", user?.is_anonymous ?? "-"
  )

  // 익명 사용자인 경우 uid 저장 → 로그인 후 데이터 병합에 사용
  if (user?.is_anonymous) {
    localStorage.setItem("pre_auth_uid", user.id)
    console.debug("[auth] pre_auth_uid 저장:", user.id)
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      queryParams: {
        prompt: "select_account",
      },
    },
  })

  if (error) {
    console.error("[auth] signInWithGoogle error:", error)
    localStorage.removeItem("pre_auth_uid")
    throw error
  }
}

export async function signOut() {
  const supabase = getSupabaseBrowserClient()
  const { error } = await supabase.auth.signOut()
  if (error) {
    console.error("[auth] signOut error:", error)
    throw error
  }
}

export async function getCurrentUser() {
  try {
    const supabase = getSupabaseBrowserClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    return user ?? null
  } catch {
    return null
  }
}

export async function mergeAnonymousToCurrent(anonUserId: string) {
  const accessToken = await getAccessToken()

  if (!accessToken) {
    throw new Error("인증이 필요합니다.")
  }

  const response = await fetch(getApiUrl("/api/auth/merge-anonymous"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ anonUserId }),
  })

  if (response.ok) {
    return
  }

  try {
    const data = (await response.json()) as { error?: string }
    if (typeof data.error === "string" && data.error.trim() !== "") {
      throw new Error(data.error)
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error
    }
  }

  throw new Error(`요청이 실패했습니다. (${response.status})`)
}

/**
 * 컴포넌트에서 auth 상태를 실시간으로 구독합니다.
 * onAuthStateChange는 구독 즉시 현재 세션을 캐시에서 읽어 callback을 실행하므로
 * getUser()의 네트워크 요청 대기 없이 빠르게 초기 상태를 설정할 수 있습니다.
 *
 * @returns 구독 해제 함수 (useEffect cleanup에 사용)
 */
export function subscribeToAuth(callback: (user: User | null) => void): () => void {
  const supabase = getSupabaseBrowserClient()
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
    callback(session?.user ?? null)
  })
  return () => subscription.unsubscribe()
}
