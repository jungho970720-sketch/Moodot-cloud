import { createServerClient } from "@supabase/ssr"
import { NextRequest, NextResponse } from "next/server"

import logger from "@/lib/logger"

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get("code")

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
