import { createServerClient } from "@supabase/ssr"
import { NextRequest, NextResponse } from "next/server"

import logger from "@/lib/logger"

type CognitoTokenResponse = {
  access_token?: string
  id_token?: string
  refresh_token?: string
  expires_in?: number
}

function isCognitoAuth() {
  return process.env.NEXT_PUBLIC_AUTH_PROVIDER === "cognito"
}

function getCognitoDomain() {
  return process.env.COGNITO_DOMAIN ?? process.env.NEXT_PUBLIC_COGNITO_DOMAIN
}

async function exchangeCognitoCode(code: string, redirectUri: string) {
  const domain = getCognitoDomain()
  const clientId = process.env.COGNITO_CLIENT_ID ?? process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID
  const clientSecret = process.env.COGNITO_CLIENT_SECRET

  if (!domain || !clientId) {
    throw new Error("Cognito callback environment variables are missing.")
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
  })

  if (clientSecret) {
    body.set("client_secret", clientSecret)
  }

  const response = await fetch(`${domain.replace(/\/$/, "")}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  })

  if (!response.ok) {
    const message = await response.text().catch(() => "")
    throw new Error(`Cognito token exchange failed. (${response.status}) ${message}`)
  }

  return (await response.json()) as CognitoTokenResponse
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get("code")
  const error = searchParams.get("error")
  const errorDescription = searchParams.get("error_description")

  // EC2/standalone 환경에서 request.url origin이 내부 바인딩 주소(0.0.0.0:3000)로
  // 잡히는 문제를 피하기 위해 요청 헤더의 x-forwarded-host / host 기준으로 origin을 계산한다.
  const forwardedHost = request.headers.get("x-forwarded-host")
  const host = forwardedHost ?? request.headers.get("host")
  const proto = request.headers.get("x-forwarded-proto") ?? "http"
  const publicOrigin =
    host && !host.startsWith("0.0.0.0")
      ? `${proto}://${host}`
      : request.nextUrl.origin

  // redirect response를 먼저 만들고, 쿠키를 이 response에 직접 설정한다.
  // cookies() / cookieStore.set() 패턴은 NextResponse에 쿠키를 포함시키지 않는다.
  const response = NextResponse.redirect(new URL("/", publicOrigin))

  if (isCognitoAuth()) {
    if (error) {
      logger.error("[auth/callback] Cognito authorization error:", error, errorDescription)
      const loginUrl = new URL("/login", publicOrigin)
      loginUrl.searchParams.set("auth_error", error)
      if (errorDescription) {
        loginUrl.searchParams.set("auth_error_description", errorDescription)
      }
      return NextResponse.redirect(loginUrl)
    }

    if (code) {
      try {
        const tokens = await exchangeCognitoCode(code, `${publicOrigin}/auth/callback`)
        const maxAge = tokens.expires_in ?? 3600
        const cookieOptions = {
          path: "/",
          maxAge,
          sameSite: "lax" as const,
          secure: proto === "https",
        }

        if (tokens.access_token) {
          response.cookies.set("moodot_cognito_access_token", tokens.access_token, cookieOptions)
        }
        if (tokens.id_token) {
          response.cookies.set("moodot_cognito_id_token", tokens.id_token, cookieOptions)
        }
        if (tokens.refresh_token) {
          response.cookies.set("moodot_cognito_refresh_token", tokens.refresh_token, {
            ...cookieOptions,
            maxAge: 60 * 60 * 24 * 30,
          })
        }

        logger.info("[auth/callback] Cognito token exchange 완료")
      } catch (error) {
        logger.error("[auth/callback] Cognito token exchange error:", error)
        const loginUrl = new URL("/login", publicOrigin)
        loginUrl.searchParams.set("auth_error", "token_exchange_failed")
        return NextResponse.redirect(loginUrl)
      }

      return response
    }
  }

  if (code) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY)!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              request.cookies.set(name, value)
              response.cookies.set(name, value, options)
            })
          },
        },
      }
    )

    try {
      await supabase.auth.exchangeCodeForSession(code)
      logger.info("[auth/callback] exchangeCodeForSession 완료")
    } catch (error) {
      logger.error("[auth/callback] exchangeCodeForSession error:", error)
    }
  }

  return response
}
