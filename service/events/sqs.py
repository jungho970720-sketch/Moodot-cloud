import asyncio
import json
import logging
import os
from typing import Any, Dict, Optional

try:
    import boto3
except ImportError:  # pragma: no cover - dependency may be absent outside SQS mode
    boto3 = None

logger = logging.getLogger(__name__)


class SqsEventConsumer:
    """Consumes AI worker events from SQS and dispatches them to the pipeline."""

    def __init__(
        self,
        store,
        pipeline,
        queue_url: str,
        region: str,
        *,
        client: Optional[Any] = None,
        wait_time_seconds: int = 20,
        max_messages: int = 5,
        idle_sleep_seconds: float = 1.0,
    ):
        if client is None and boto3 is None:
            raise RuntimeError("boto3 is required when WORKER_EVENT_SOURCE=sqs.")

        self.store = store
        self.pipeline = pipeline
        self.queue_url = queue_url
        self.client = client or boto3.client("sqs", region_name=region)
        self.wait_time_seconds = wait_time_seconds
        self.max_messages = max(1, min(max_messages, 10))
        self.idle_sleep_seconds = idle_sleep_seconds

    @classmethod
    def from_env(cls, store, pipeline) -> "SqsEventConsumer":
        queue_url = os.getenv("SQS_QUEUE_URL") or os.getenv("AI_EVENT_QUEUE_URL")
        if not queue_url:
            raise RuntimeError("SQS_QUEUE_URL or AI_EVENT_QUEUE_URL is required.")

        region = (
            os.getenv("SQS_REGION")
            or os.getenv("AWS_REGION")
            or os.getenv("COGNITO_REGION")
            or "ap-northeast-2"
        )

        return cls(
            store,
            pipeline,
            queue_url,
            region,
            wait_time_seconds=int(os.getenv("SQS_WAIT_TIME_SECONDS", "20")),
            max_messages=int(os.getenv("SQS_MAX_MESSAGES", "5")),
        )

    async def run_forever(self) -> None:
        logger.info("👂 SQS 이벤트 수신 시작: %s", self.queue_url)
        while True:
            try:
                messages = await self._receive_messages()
                if not messages:
                    await asyncio.sleep(self.idle_sleep_seconds)
                    continue

                for message in messages:
                    await self.handle_message(message)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                logger.error("❌ SQS 수신 루프 오류: %s", error, exc_info=True)
                await asyncio.sleep(5)

    async def _receive_messages(self) -> list[Dict[str, Any]]:
        response = await asyncio.to_thread(
            self.client.receive_message,
            QueueUrl=self.queue_url,
            MaxNumberOfMessages=self.max_messages,
            WaitTimeSeconds=self.wait_time_seconds,
            MessageAttributeNames=["All"],
        )
        return response.get("Messages", [])

    async def handle_message(self, message: Dict[str, Any]) -> bool:
        should_delete = await self._process_message(message)
        if should_delete:
            await self._delete_message(message["ReceiptHandle"])
        return should_delete

    async def handle_lambda_record(self, record: Dict[str, Any]) -> bool:
        message = {
            "Body": record.get("body"),
            "ReceiptHandle": record.get("receiptHandle"),
        }
        return await self._process_message(message)

    async def _process_message(self, message: Dict[str, Any]) -> bool:
        event = self._parse_body(message.get("Body"))
        if not event:
            return True

        event_type = event.get("type")
        if event_type != "memory.created":
            logger.warning("지원하지 않는 SQS event type: %s", event_type)
            return True

        memory_id = event.get("memory_id")
        if not memory_id:
            logger.warning("memory_id가 없는 SQS message: %s", event)
            return True

        memory = await self.store.fetch_memory_by_id(int(memory_id))
        if not memory:
            logger.warning("SQS memory.created 대상 memory를 찾지 못함: %s", memory_id)
            return False

        if memory.get("processed"):
            logger.info("이미 처리된 memory라 SQS message 삭제: %s", memory_id)
            return True

        logger.info("SQS memory.created 처리 시작: memory_id=%s", memory_id)
        return await self.pipeline.process_emotion({"record": memory})

    @staticmethod
    def _parse_body(body: Optional[str]) -> Optional[Dict[str, Any]]:
        if not body:
            logger.warning("비어 있는 SQS message body")
            return None

        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            logger.warning("JSON이 아닌 SQS message body: %s", body)
            return None

        if not isinstance(parsed, dict):
            logger.warning("객체가 아닌 SQS message body: %s", parsed)
            return None

        return parsed

    async def _delete_message(self, receipt_handle: str) -> None:
        await asyncio.to_thread(
            self.client.delete_message,
            QueueUrl=self.queue_url,
            ReceiptHandle=receipt_handle,
        )
