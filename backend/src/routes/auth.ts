import { Router } from "express"

import { getSupabaseUserClient } from "../lib/supabase.js"

type MergeAnonymousInput = {
  anonUserId?: unknown
}

export const authRouter = Router()

authRouter.post("/merge-anonymous", async (request, response, next) => {
  try {
    const input = request.body as MergeAnonymousInput
    const anonUserId =
      typeof input.anonUserId === "string" && input.anonUserId.trim() !== ""
        ? input.anonUserId.trim()
        : null

    if (!anonUserId) {
      response.status(400).json({ error: "익명 사용자 ID가 필요합니다." })
      return
    }

    const { supabase } = await getSupabaseUserClient(request)
    const { error } = await supabase.rpc("merge_anonymous_to_current", {
      anon_user_id: anonUserId,
    })

    if (error) throw error

    response.status(204).send()
  } catch (error) {
    next(error)
  }
})
