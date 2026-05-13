import { createBrowserClient } from "@supabase/ssr"

// createBrowserClient는 호출마다 쿠키에서 최신 세션을 읽으므로 싱글턴을 사용하지 않는다.
// 싱글턴을 사용하면 signInAnonymously() 완료 전에 생성된 인스턴스가 세션 없는 상태로 고착될 수 있다.
export function getSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error("Supabase environment variables are missing.")
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createBrowserClient<any>(url, anonKey)
}
