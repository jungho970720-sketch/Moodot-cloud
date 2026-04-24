import { randomUUID } from "node:crypto"
import { extname } from "node:path"

import { Router } from "express"

import { HttpError, getSupabaseUserClient } from "../lib/supabase.js"

const BUCKET = "memory-images"
const SIGNED_URL_TTL_SECONDS = 3600

type UploadImageInput = {
  fileName?: unknown
  fileType?: unknown
  fileData?: unknown
}

function getFileExtension(fileName: string, fileType: string | null) {
  const nameExt = extname(fileName).replace(".", "").toLowerCase()
  if (nameExt) return nameExt

  const mimeExt = fileType?.split("/")[1]?.split("+")[0]?.toLowerCase() ?? ""
  return mimeExt || "jpg"
}

function parseBase64Payload(rawValue: unknown) {
  if (typeof rawValue !== "string" || rawValue.trim() === "") {
    throw new HttpError("업로드할 이미지 데이터가 필요합니다.", 400)
  }

  try {
    return Buffer.from(rawValue, "base64")
  } catch {
    throw new HttpError("이미지 데이터를 해석할 수 없습니다.", 400)
  }
}

export const storageRouter = Router()

storageRouter.post("/images", async (request, response, next) => {
  try {
    const input = request.body as UploadImageInput
    const fileName =
      typeof input.fileName === "string" && input.fileName.trim() !== ""
        ? input.fileName.trim()
        : "upload.jpg"
    const fileType =
      typeof input.fileType === "string" && input.fileType.trim() !== ""
        ? input.fileType.trim()
        : null
    const fileBuffer = parseBase64Payload(input.fileData)

    const { supabase, user } = await getSupabaseUserClient(request)
    const ext = getFileExtension(fileName, fileType)
    const path = `${user.id}/${Date.now()}-${randomUUID()}.${ext}`

    const { error } = await supabase.storage.from(BUCKET).upload(path, fileBuffer, {
      contentType: fileType ?? undefined,
      upsert: false,
    })

    if (error) throw error

    response.status(201).json({ path })
  } catch (error) {
    next(error)
  }
})

storageRouter.get("/images/signed-url", async (request, response, next) => {
  try {
    const path =
      typeof request.query.path === "string" && request.query.path.trim() !== ""
        ? request.query.path.trim()
        : null

    if (!path) {
      response.status(400).json({ error: "이미지 경로가 필요합니다." })
      return
    }

    const { supabase } = await getSupabaseUserClient(request)
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)

    if (error) throw error

    response.json({ url: data.signedUrl })
  } catch (error) {
    next(error)
  }
})
