import { createClient } from "@supabase/supabase-js"
import type { Request } from "express"

import { requireEnv } from "../config/env.js"

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

function getBearerToken(request: Request) {
  const header = request.header("authorization")
  const match = header?.match(/^Bearer\s+(.+)$/i)
  return match?.[1] ?? null
}

export async function getSupabaseUserClient(request: Request) {
  const token = getBearerToken(request)

  if (!token) {
    throw new HttpError("인증이 필요합니다.", 401)
  }

  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL")
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ??
    process.env.SUPABASE_ANON_KEY

  if (!anonKey) {
    throw new Error("Supabase anon key is missing.")
  }

  const supabase = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  })

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token)

  if (error || !user) {
    throw new HttpError("인증이 필요합니다.", 401)
  }

  return { supabase, user }
}
