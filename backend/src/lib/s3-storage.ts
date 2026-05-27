import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

const SIGNED_URL_TTL_SECONDS = 3600

let client: S3Client | null = null

function getBucketName() {
  return process.env.S3_BUCKET ?? process.env.AWS_S3_BUCKET
}

function getRegion() {
  return process.env.S3_REGION ?? process.env.AWS_REGION ?? process.env.COGNITO_REGION
}

export function hasS3StorageConfig() {
  return Boolean(getBucketName() && getRegion())
}

function getS3Client() {
  if (client) return client

  const region = getRegion()
  if (!region) {
    throw new Error("S3 region is missing.")
  }

  client = new S3Client({ region })
  return client
}

function getRequiredBucketName() {
  const bucket = getBucketName()
  if (!bucket) {
    throw new Error("S3 bucket is missing.")
  }
  return bucket
}

export async function uploadObjectToS3(input: {
  key: string
  body: Buffer
  contentType?: string | null
}) {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: getRequiredBucketName(),
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType ?? undefined,
    }),
  )
}

export async function createS3SignedUrl(key: string) {
  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({
      Bucket: getRequiredBucketName(),
      Key: key,
    }),
    { expiresIn: SIGNED_URL_TTL_SECONDS },
  )
}
