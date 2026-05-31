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
  exp?: number
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

function isExpired(payload: CognitoJwtPayload | null) {
  if (!payload?.exp) return false
  return payload.exp * 1000 <= Date.now()
}

function clearCognitoCookies() {
  clearCookie("moodot_cognito_access_token")
  clearCookie("moodot_cognito_id_token")
  clearCookie("moodot_cognito_refresh_token")
}

function getCognitoUser(): AppUser | null {
  const token = getCookie("moodot_cognito_id_token")
  if (!token) return null

  const payload = decodeJwtPayload(token)
  if (!payload?.sub || isExpired(payload)) {
    clearCognitoCookies()
    return null
  }

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

export async function getAccessToken(): Promise<string | null> {
  const token = getCookie("moodot_cognito_access_token")
  if (!token) return null

  if (isExpired(decodeJwtPayload(token))) {
    clearCognitoCookies()
    return null
  }

  return token
}

export async function signInWithGoogle() {
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
}

export async function signOut() {
  const domain = getCognitoDomain()
  const clientId = getCognitoClientId()
  clearCognitoCookies()

  if (domain && clientId) {
    const params = new URLSearchParams({
      client_id: clientId,
      logout_uri: `${window.location.origin}/login`,
    })
    window.location.assign(`${domain}/logout?${params.toString()}`)
  }
}

export async function getCurrentUser(): Promise<AppUser | null> {
  return getCognitoUser()
}

export function subscribeToAuth(
  callback: (user: AppUser | null) => void,
): () => void {
  callback(getCognitoUser())

  const onFocus = () => callback(getCognitoUser())
  window.addEventListener("focus", onFocus)
  return () => window.removeEventListener("focus", onFocus)
}
