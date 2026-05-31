import type { Request } from "express"

import { verifyCognitoToken } from "./cognito.js"

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

export function getBearerToken(request: Request) {
  const header = request.header("authorization")
  const match = header?.match(/^Bearer\s+(.+)$/i)
  return match?.[1] ?? null
}

export async function getAuthenticatedUser(request: Request) {
  const token = getBearerToken(request)

  if (!token) {
    throw new HttpError("인증이 필요합니다.", 401)
  }

  return verifyCognitoToken(token)
}
