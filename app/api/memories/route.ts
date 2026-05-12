import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

import logger from "@/lib/logger"
import { validateMemoryMutationInput } from "@/lib/memory-validation"
import type { CreateMemoryInput } from "@/lib/services/memory"
import {
  MEMORY_SELECT_COLUMNS,
  toPublicMemoryRow,
  type MemoryDbRow,
} from "@/lib/server/memory-records"
import { encryptMemoryText } from "@/lib/server/memory-text-crypto"
import { getSupabaseServerClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_MEMORY_LIST_LIMIT = 50

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  )
}

function parseMemoryListRange(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit")
  const offsetParam = request.nextUrl.searchParams.get("offset")

  if (limitParam === null) {
    return { ok: true as const, limit: null, offset: 0 }
  }

  if (!/^\d+$/.test(limitParam)) {
    return { ok: false as const, error: "limit은 1 이상 50 이하의 숫자여야 합니다." }
  }

  const parsedLimit = Number(limitParam)
  if (!Number.isSafeInteger(parsedLimit) || parsedLimit <= 0) {
    return { ok: false as const, error: "limit은 1 이상 50 이하의 숫자여야 합니다." }
  }

  if (offsetParam !== null && !/^\d+$/.test(offsetParam)) {
    return { ok: false as const, error: "offset은 0 이상의 숫자여야 합니다." }
  }

  const parsedOffset = offsetParam === null ? 0 : Number(offsetParam)
  if (!Number.isSafeInteger(parsedOffset)) {
    return { ok: false as const, error: "offset은 0 이상의 숫자여야 합니다." }
  }

  return {
    ok: true as const,
    limit: Math.min(parsedLimit, MAX_MEMORY_LIST_LIMIT),
    offset: parsedOffset,
  }
}

async function readJsonBody(request: Request) {
  try {
    return { ok: true as const, body: await request.json() }
  } catch {
    return { ok: false as const, error: "요청 본문이 올바른 JSON이 아닙니다." }
  }
}

function buildCreatePayload(input: CreateMemoryInput, userId: string) {
  const encryptedText = encryptMemoryText(input.text)

  return {
    ...input,
    user_id: userId,
    text: null,
    ...encryptedText,
  }
}

export async function GET(request: NextRequest) {
  const t0 = Date.now()
  logger.info("[perf][memories/list] start")

  try {
    const t1 = Date.now()
    const supabase = await getSupabaseServerClient()
    logger.info(`[perf][memories/list] supabase client: ${Date.now() - t1}ms`)

    const t2 = Date.now()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    logger.info(`[perf][memories/list] auth.getUser: ${Date.now() - t2}ms`)

    if (!user) {
      return jsonError("인증이 필요합니다.", 401)
    }

    const range = parseMemoryListRange(request)
    if (!range.ok) {
      return jsonError(range.error, 400)
    }

    let query = supabase
      .from("memories")
      .select(MEMORY_SELECT_COLUMNS)
      .eq("user_id", user.id)
      .order("memory_at", { ascending: false })

    if (range.limit !== null) {
      query = query.range(range.offset, range.offset + range.limit - 1)
    }

    const t3 = Date.now()
    const { data, error } = await query
    logger.info(`[perf][memories/list] db query: ${Date.now() - t3}ms`)
    if (error) throw error

    const t4 = Date.now()
    const rows = ((data ?? []) as MemoryDbRow[]).map(toPublicMemoryRow)
    logger.info(`[perf][memories/list] decrypt: ${Date.now() - t4}ms rows=${rows.length}`)

    logger.info(`[perf][memories/list] total: ${Date.now() - t0}ms`)
    return NextResponse.json(rows, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    logger.error("[memories/list] GET error:", error)
    return jsonError("메모리를 불러오지 못했습니다.", 500)
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await getSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return jsonError("인증이 필요합니다.", 401)
    }

    const body = await readJsonBody(request)
    if (!body.ok) {
      return jsonError(body.error, 400)
    }

    const validation = validateMemoryMutationInput(body.body)
    if (!validation.ok) {
      return jsonError(validation.error, 400)
    }

    const { data, error } = await supabase
      .from("memories")
      .insert(buildCreatePayload(validation.value, user.id) as unknown as never)
      .select("id")
      .single()

    if (error) throw error

    return NextResponse.json({ id: (data as { id: number }).id })
  } catch (error) {
    logger.error("[memories/list] POST error:", error)
    return jsonError("메모리 저장에 실패했습니다.", 500)
  }
}
