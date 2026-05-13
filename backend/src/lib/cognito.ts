import { createPublicKey, createVerify } from "node:crypto"
import type { JsonWebKey as NodeJsonWebKey } from "node:crypto"

import { HttpError } from "./supabase.js"

type CognitoJwtPayload = {
  sub?: string
  aud?: string
  client_id?: string
  email?: string
  iss?: string
  exp?: number
}

type CognitoJwk = NodeJsonWebKey & { kid?: string }

type Jwks = {
  keys: CognitoJwk[]
}

let cachedJwks: Jwks | null = null

function decodeBase64Url(value: string) {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=")
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64")
}

function decodeJsonSegment<T>(segment: string): T {
  return JSON.parse(decodeBase64Url(segment).toString("utf8")) as T
}

function getCognitoConfig() {
  const region = process.env.COGNITO_REGION ?? process.env.AWS_REGION
  const userPoolId = process.env.COGNITO_USER_POOL_ID
  const clientId = process.env.COGNITO_CLIENT_ID ?? process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID

  if (!region || !userPoolId || !clientId) {
    throw new Error("Cognito environment variables are missing.")
  }

  return {
    clientId,
    issuer: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`,
  }
}

async function getJwks(issuer: string) {
  if (cachedJwks) return cachedJwks

  const response = await fetch(`${issuer}/.well-known/jwks.json`)
  if (!response.ok) {
    throw new Error(`Failed to load Cognito JWKS. (${response.status})`)
  }

  cachedJwks = (await response.json()) as Jwks
  return cachedJwks
}

function verifySignature(token: string, key: CognitoJwk) {
  const [header, payload, signature] = token.split(".")
  const verifier = createVerify("RSA-SHA256")
  verifier.update(`${header}.${payload}`)
  verifier.end()

  return verifier.verify(
    createPublicKey({ key, format: "jwk" }),
    decodeBase64Url(signature),
  )
}

export async function verifyCognitoToken(token: string) {
  const [encodedHeader, encodedPayload] = token.split(".")
  if (!encodedHeader || !encodedPayload) {
    throw new HttpError("인증이 필요합니다.", 401)
  }

  const header = decodeJsonSegment<{ kid?: string }>(encodedHeader)
  const payload = decodeJsonSegment<CognitoJwtPayload>(encodedPayload)
  const { clientId, issuer } = getCognitoConfig()

  if (payload.iss !== issuer) {
    throw new HttpError("인증 토큰 발급자가 올바르지 않습니다.", 401)
  }

  if (payload.exp && payload.exp * 1000 < Date.now()) {
    throw new HttpError("인증 토큰이 만료되었습니다.", 401)
  }

  if (payload.aud !== clientId && payload.client_id !== clientId) {
    throw new HttpError("인증 토큰 대상이 올바르지 않습니다.", 401)
  }

  const jwks = await getJwks(issuer)
  const key = jwks.keys.find((candidate) => candidate.kid === header.kid)
  if (!key || !verifySignature(token, key)) {
    throw new HttpError("인증 토큰 서명 검증에 실패했습니다.", 401)
  }

  if (!payload.sub) {
    throw new HttpError("인증 사용자 정보를 확인할 수 없습니다.", 401)
  }

  return {
    id: payload.sub,
    email: payload.email ?? null,
    is_anonymous: false,
  }
}
