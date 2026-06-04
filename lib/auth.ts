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
  given_name?: string
  family_name?: string
  nickname?: string
  preferred_username?: string
  picture?: string
  "cognito:username"?: string
  exp?: number
}

type CognitoUserInfo = {
  sub?: string
  email?: string
  name?: string
  given_name?: string
  family_name?: string
  nickname?: string
  preferred_username?: string
  picture?: string
  username?: string
}

let userInfoCache: {
  accessToken: string
  user: AppUser
} | null = null

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
  userInfoCache = null
}

function getDisplayName(payload: CognitoJwtPayload | CognitoUserInfo) {
  const fullName = [payload.given_name, payload.family_name].filter(Boolean).join(" ")
  return (
    payload.name ??
    (fullName || undefined) ??
    payload.nickname ??
    payload.preferred_username ??
    payload.email?.split("@")[0] ??
    ("cognito:username" in payload ? payload["cognito:username"] : undefined) ??
    ("username" in payload ? payload.username : undefined)
  )
}

function toAppUser(payload: CognitoJwtPayload | CognitoUserInfo): AppUser | null {
  const id = payload.sub
  if (!id) return null

  return {
    id,
    email: payload.email ?? null,
    is_anonymous: false,
    user_metadata: {
      name: getDisplayName(payload),
      avatar_url: payload.picture,
    },
  }
}

function getCognitoUserFromToken(): AppUser | null {
  const token = getCookie("moodot_cognito_id_token")
  if (!token) return null

  const payload = decodeJwtPayload(token)
  if (!payload?.sub || isExpired(payload)) {
    clearCognitoCookies()
    return null
  }

  return toAppUser(payload)
}

async function fetchCognitoUserInfo(): Promise<AppUser | null> {
  const domain = getCognitoDomain()
  const accessToken = await getAccessToken()
  if (!domain || !accessToken) return null

  if (userInfoCache?.accessToken === accessToken) {
    return userInfoCache.user
  }

  try {
    const response = await fetch(`${domain}/oauth2/userInfo`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) return null

    const user = toAppUser((await response.json()) as CognitoUserInfo)
    if (user) {
      userInfoCache = { accessToken, user }
    }
    return user
  } catch (error) {
    logger.warn("[auth] Cognito userInfo fetch failed:", error)
    return null
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
    prompt: "login select_account",
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
  return (await fetchCognitoUserInfo()) ?? getCognitoUserFromToken()
}

export function subscribeToAuth(
  callback: (user: AppUser | null) => void,
): () => void {
  let isSubscribed = true
  callback(getCognitoUserFromToken())

  fetchCognitoUserInfo().then((user) => {
    if (isSubscribed && user) callback(user)
  })

  const onFocus = () => {
    callback(getCognitoUserFromToken())
    fetchCognitoUserInfo().then((user) => {
      if (isSubscribed && user) callback(user)
    })
  }
  window.addEventListener("focus", onFocus)
  return () => {
    isSubscribed = false
    window.removeEventListener("focus", onFocus)
  }
}
