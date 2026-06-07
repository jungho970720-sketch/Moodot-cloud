# main.py
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from events import SqsEventConsumer
from runtime import configure_logging, create_runtime, load_worker_env

load_worker_env()
configure_logging()
logger = logging.getLogger(__name__)


async def process_missed_emotions(store, pipeline) -> None:
    """워커가 다운되었을 때 놓친 감정 처리 (안전장치)"""
    logger.info("🔍 놓친 감정 확인 중...")
    try:
        missed = await store.fetch_unprocessed_memories(
            datetime.now(timezone.utc) - timedelta(minutes=1),
            limit=10,
        )
        if not missed:
            logger.info("✅ 놓친 감정 없음")
            return

        logger.warning(f"⚠️ 놓친 감정 {len(missed)}개 발견! 처리 시작...")
        for emotion in missed:
            await pipeline.process_emotion({'record': emotion})
        logger.info("✅ 놓친 감정 처리 완료")

    except Exception as e:
        logger.error(f"❌ 놓친 감정 처리 실패: {e}", exc_info=True)


async def periodic_check(store, pipeline) -> None:
    """5분마다 놓친 감정 체크"""
    while True:
        await asyncio.sleep(5 * 60)
        await process_missed_emotions(store, pipeline)


def get_worker_event_source() -> str:
    import os

    return os.getenv("WORKER_EVENT_SOURCE", "polling").lower()


async def initial_check(store, pipeline) -> None:
    """초기 놓친 감정 체크 (5초 후)"""
    await asyncio.sleep(5)
    await process_missed_emotions(store, pipeline)


async def health_server() -> None:
    """최소 HTTP 헬스 서버"""
    port = int(os.getenv("PORT", 8000))

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        try:
            await asyncio.wait_for(reader.read(1024), timeout=5)
            body = b'{"status":"ok"}'
            writer.write(
                b"HTTP/1.1 200 OK\r\n"
                b"Content-Type: application/json\r\n"
                b"Content-Length: " + str(len(body)).encode() + b"\r\n"
                b"\r\n" + body
            )
            await writer.drain()
        except Exception:
            pass
        finally:
            writer.close()

    server = await asyncio.start_server(handle, "0.0.0.0", port)
    logger.info(f"🌐 Health server 시작: port={port}")
    async with server:
        await server.serve_forever()


async def main() -> None:
    logger.info("🚀 AI 에이전트 워커 시작...")

    runtime = await create_runtime()
    data_store = runtime.store
    pipeline = runtime.pipeline

    if get_worker_event_source() == "sqs":
        logger.info("👂 SQS 이벤트 모드로 동작합니다. RDS polling fallback도 유지합니다.")
        sqs_consumer = SqsEventConsumer.from_env(data_store, pipeline)
        await asyncio.gather(
            health_server(),
            initial_check(data_store, pipeline),
            periodic_check(data_store, pipeline),
            sqs_consumer.run_forever(),
        )
    else:
        logger.info("👂 RDS polling 모드로 동작합니다.")
        await asyncio.gather(
            health_server(),
            initial_check(data_store, pipeline),
            periodic_check(data_store, pipeline),
        )


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("\n👋 워커 정상 종료됨")
