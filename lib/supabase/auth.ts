import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import type { User as SupabaseUser } from "@supabase/supabase-js"
import logger from "@/lib/logger"

export type AppUser = {
  id: string
  email?: string | null
  is_anonymous?: boolean
  user_metadata?: {
    name?: string
    avatar_url?: string
  }
}

type CognitoJwtPayload = {
  sub?: string
  email?: string
  name?: string
  picture?: string
}

function getApiUrl(path: string) {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "")
  return baseUrl ? `${baseUrl}${path}` : path
}

function isCognitoAuth() {
  return process.env.NEXT_PUBLIC_AUTH_PROVIDER === "cognito"
}

function getCognitoDomain() {
  return process.env.NEXT_PUBLIC_COGNITO_DOMAIN?.replace(/\/$/, "")
}

function getCognitoClientId() {
  return process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID
}

function getCookie(name: string) {
  if (typeof document === "undefined") return null
  const cookie = document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${name}=`))
  return cookie ? decodeURIComponent(cookie.split("=").slice(1).join("=")) : null
}

function clearCookie(name: string) {
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`
}

function decodeBase64Url(value: string) {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=")
  return atob(padded.replace(/-/g, "+").replace(/_/g, "/"))
}

function decodeJwtPayload(token: string) {
  const payload = token.split(".")[1]
  if (!payload) return null

  try {
    return JSON.parse(decodeBase64Url(payload)) as CognitoJwtPayload
  } catch {
    return null
  }
}

function getCognitoUser(): AppUser | null {
  const token = getCookie("moodot_cognito_id_token")
  if (!token) return null

  const payload = decodeJwtPayload(token)
  if (!payload?.sub) return null

  return {
    id: payload.sub,
    email: payload.email ?? null,
    is_anonymous: false,
    user_metadata: {
      name: payload.name,
      avatar_url: payload.picture,
    },
  }
}

export async function getAccessToken() {
  if (isCognitoAuth()) {
    return getCookie("moodot_cognito_access_token")
  }

  const supabase = getSupabaseBrowserClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  return session?.access_token ?? null
}

export async function signInAnonymously() {
  if (isCognitoAuth()) {
    return
  }

  const supabase = getSupabaseBrowserClient()
  const { error } = await supabase.auth.signInAnonymously()
  if (error) logger.error("[auth] signInAnonymously error:", error)
}

export async function signInWithGoogle() {
  if (isCognitoAuth()) {
    const domain = getCognitoDomain()
    const clientId = getCognitoClientId()

    if (!domain || !clientId) {
      throw new Error("Cognito 로그인 환경변수가 설정되지 않았습니다.")
    }

    const redirectUri = `${window.location.origin}/auth/callback`
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      scope: "openid email profile",
      redirect_uri: redirectUri,
      identity_provider: "Google",
    })

    window.location.assign(`${domain}/oauth2/authorize?${params.toString()}`)
    return
  }

  const supabase = getSupabaseBrowserClient()
  const redirectTo = `${window.location.origin}/auth/callback`

  const { data: { user } } = await supabase.auth.getUser()

  logger.debug(
    "[auth] signInWithGoogle | user.id:", user?.id ?? "null",
    "| is_anonymous:", user?.is_anonymous ?? "-"
  )

  // 익명 사용자인 경우 uid 저장 → 로그인 후 데이터 병합에 사용
  if (user?.is_anonymous) {
    localStorage.setItem("pre_auth_uid", user.id)
    logger.debug("[auth] pre_auth_uid 저장:", user.id)
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
    logger.error("[auth] signInWithGoogle error:", error)
    localStorage.removeItem("pre_auth_uid")
    throw error
  }
}

export async function signOut() {
  if (isCognitoAuth()) {
    const domain = getCognitoDomain()
    const clientId = getCognitoClientId()
    clearCookie("moodot_cognito_access_token")
    clearCookie("moodot_cognito_id_token")
    clearCookie("moodot_cognito_refresh_token")

    if (domain && clientId) {
      const params = new URLSearchParams({
        client_id: clientId,
        logout_uri: `${window.location.origin}/login`,
      })
      window.location.assign(`${domain}/logout?${params.toString()}`)
    }

    return
  }

  const supabase = getSupabaseBrowserClient()
  const { error } = await supabase.auth.signOut()
  if (error) {
    logger.error("[auth] signOut error:", error)
    throw error
  }
}

export async function getCurrentUser(): Promise<AppUser | SupabaseUser | null> {
  if (isCognitoAuth()) {
    return getCognitoUser()
  }

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
  if (isCognitoAuth()) {
    return
  }

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
export function subscribeToAuth(
  callback: (user: AppUser | SupabaseUser | null) => void,
): () => void {
  if (isCognitoAuth()) {
    callback(getCognitoUser())

    const onFocus = () => callback(getCognitoUser())
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }

  const supabase = getSupabaseBrowserClient()
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
    callback(session?.user ?? null)
  })
  return () => subscription.unsubscribe()
}
