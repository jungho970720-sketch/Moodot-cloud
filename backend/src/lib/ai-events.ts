import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs"

type MemoryCreatedEvent = {
  type: "memory.created"
  memory_id: number
  user_id: string
  created_at: string
}

let client: SQSClient | null = null

function getQueueUrl() {
  return process.env.AI_EVENT_QUEUE_URL ?? process.env.SQS_QUEUE_URL
}

function getRegion() {
  return process.env.SQS_REGION ?? process.env.AWS_REGION ?? process.env.COGNITO_REGION
}

export function hasAiEventQueueConfig() {
  return Boolean(getQueueUrl() && getRegion())
}

function getSqsClient() {
  if (client) return client

  const region = getRegion()
  if (!region) {
    throw new Error("SQS region is missing.")
  }

  client = new SQSClient({ region })
  return client
}

export async function publishMemoryCreatedEvent(event: MemoryCreatedEvent) {
  const queueUrl = getQueueUrl()

  if (!queueUrl) {
    return false
  }

  await getSqsClient().send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(event),
      MessageAttributes: {
        event_type: {
          DataType: "String",
          StringValue: event.type,
        },
      },
    }),
  )

  return true
}
