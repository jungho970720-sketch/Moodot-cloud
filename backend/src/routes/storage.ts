import { randomUUID } from "node:crypto"
import { extname } from "node:path"

import { Router } from "express"

import {
  createS3SignedUrl,
  hasS3StorageConfig,
  uploadObjectToS3,
} from "../lib/s3-storage.js"
import { HttpError, getAuthenticatedUser, getSupabaseUserClient } from "../lib/supabase.js"

const BUCKET = "memory-images"
const S3_PATH_PREFIX = "s3/"
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

function toS3StoragePath(key: string) {
  return `${S3_PATH_PREFIX}${key}`
}

function getS3ObjectKey(path: string) {
  return path.startsWith(S3_PATH_PREFIX) ? path.slice(S3_PATH_PREFIX.length) : null
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

    const user = hasS3StorageConfig()
      ? await getAuthenticatedUser(request)
      : (await getSupabaseUserClient(request)).user
    const ext = getFileExtension(fileName, fileType)
    const path = `${user.id}/${Date.now()}-${randomUUID()}.${ext}`

    if (hasS3StorageConfig()) {
      await uploadObjectToS3({
        key: path,
        body: fileBuffer,
        contentType: fileType,
      })

      response.status(201).json({ path: toS3StoragePath(path) })
      return
    }

    const { supabase } = await getSupabaseUserClient(request)
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

    const s3Key = getS3ObjectKey(path)
    if (s3Key && hasS3StorageConfig()) {
      try {
        const url = await createS3SignedUrl(s3Key)
        response.json({ url })
        return
      } catch (error) {
        console.warn("[storage] S3 signed URL failed; falling back to Supabase Storage.", error)
      }
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
