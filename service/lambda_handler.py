import asyncio
from typing import Any, Dict

from events import SqsEventConsumer
from runtime import WorkerRuntime, configure_logging, create_runtime, load_worker_env


load_worker_env()
configure_logging()


async def _handle_sqs_event(event: Dict[str, Any]) -> Dict[str, Any]:
    runtime: WorkerRuntime | None = None
    failures: list[Dict[str, str]] = []

    try:
        runtime = await create_runtime()
        consumer = SqsEventConsumer.from_env(runtime.store, runtime.pipeline)

        for record in event.get("Records", []):
            if record.get("eventSource") != "aws:sqs":
                continue

            success = await consumer.handle_lambda_record(record)
            if not success and record.get("messageId"):
                failures.append({"itemIdentifier": record["messageId"]})

        return {"batchItemFailures": failures}
    finally:
        if runtime is not None:
            await runtime.close()


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    return asyncio.run(_handle_sqs_event(event))
