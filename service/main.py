# main.py
import os
import asyncio
import logging
from dotenv import load_dotenv
from supabase import acreate_client
from typing import Dict, Any
from datetime import datetime, timedelta, timezone

load_dotenv('.env.local')

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),  # DEBUG | INFO | WARNING | ERROR | CRITICAL
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

from models import InterventionRepository
from rules import RuleEngine
from config import LLMFactory
from generators import MessageGenerator
from agents import Pipeline
from db import WorkerPostgresStore


async def create_supabase_client():
    client = await acreate_client(
        os.getenv("SUPABASE_URL"),
        os.getenv("SUPABASE_SERVICE_KEY")
    )
    client.realtime.timeout = 30
    return client


async def create_data_store():
    provider = os.getenv("WORKER_DATA_PROVIDER", "supabase").lower()

    if provider in ("rds", "postgres", "postgresql"):
        logger.info("📡 Worker data provider: RDS PostgreSQL")
        return await WorkerPostgresStore.create()

    logger.info(f"📡 Supabase URL: {os.getenv('SUPABASE_URL')}")
    return await create_supabase_client()


async def process_missed_emotions(supabase, pipeline: Pipeline) -> None:
    """워커가 다운되었을 때 놓친 감정 처리 (안전장치)"""
    logger.info("🔍 놓친 감정 확인 중...")
    try:
        if hasattr(supabase, "fetch_unprocessed_memories"):
            missed = await supabase.fetch_unprocessed_memories(
                datetime.now(timezone.utc) - timedelta(minutes=1),
                limit=10,
            )
        else:
            one_minute_ago = (datetime.now() - timedelta(minutes=1)).isoformat()
            result = await supabase.table('memories') \
                .select('*') \
                .eq('processed', False) \
                .lt('created_at', one_minute_ago) \
                .order('created_at') \
                .limit(10) \
                .execute()

            missed = result.data if hasattr(result, 'data') else []
        if not missed:
            logger.info("✅ 놓친 감정 없음")
            return

        logger.warning(f"⚠️ 놓친 감정 {len(missed)}개 발견! 처리 시작...")
        for emotion in missed:
            await pipeline.process_emotion({'record': emotion})
        logger.info("✅ 놓친 감정 처리 완료")

    except Exception as e:
        logger.error(f"❌ 놓친 감정 처리 실패: {e}", exc_info=True)


async def periodic_check(supabase, pipeline: Pipeline) -> None:
    """5분마다 놓친 감정 체크"""
    while True:
        await asyncio.sleep(5 * 60)
        await process_missed_emotions(supabase, pipeline)


async def initial_check(supabase, pipeline: Pipeline) -> None:
    """초기 놓친 감정 체크 (5초 후)"""
    await asyncio.sleep(5)
    await process_missed_emotions(supabase, pipeline)


async def health_server() -> None:
    """Render Web Service용 최소 HTTP 서버"""
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


async def subscribe_channels(supabase, pipeline: Pipeline) -> None:
    emotion_channel = supabase.channel('emotion_events')
    emotion_channel.on_postgres_changes(
        event='INSERT',
        schema='public',
        table='memories',
        callback=lambda payload: asyncio.get_running_loop().create_task(
            pipeline.process_emotion(payload)
        )
    )
    await emotion_channel.subscribe()

    feedback_channel = supabase.channel('feedback_events')
    feedback_channel.on_postgres_changes(
        event='INSERT',
        schema='public',
        table='intervention_feedback',
        callback=lambda payload: asyncio.get_running_loop().create_task(
            pipeline.process_feedback(payload)
        )
    )
    await feedback_channel.subscribe()
    logger.info("✅ Realtime 구독 시작!")


async def realtime_watchdog(supabase, pipeline: Pipeline) -> None:
    """60초마다 WebSocket 연결 상태 확인 후 끊겼으면 재구독"""
    await asyncio.sleep(60)
    while True:
        await asyncio.sleep(60)
        if not supabase.realtime.is_connected:
            logger.warning("⚠️ Realtime 연결 끊김 감지. 재연결 시도...")
            for attempt in range(3):
                try:
                    await supabase.realtime.remove_all_channels()
                    await subscribe_channels(supabase, pipeline)
                    logger.info("✅ Realtime 재연결 성공")
                    break
                except Exception as e:
                    logger.error(f"재연결 실패 (시도 {attempt + 1}/3): {e}")
                    if attempt < 2:
                        await asyncio.sleep(5)
            else:
                logger.error("❌ Realtime 재연결 최종 실패. 워커를 재시작하세요.")


async def main() -> None:
    logger.info("🚀 AI 에이전트 워커 시작...")

    data_store = await create_data_store()
    intervention_repo = InterventionRepository(data_store)
    rule_engine = RuleEngine(data_store)

    try:
        llm = LLMFactory.create()
        message_generator = MessageGenerator(llm)
        logger.info(f"✅ MessageGenerator 초기화 완료 ({llm.model_name})")
    except Exception as e:
        message_generator = None
        logger.warning(f"⚠️ LLM 연결 실패 — 템플릿 메시지로 동작합니다: {e}")

    pipeline = Pipeline(data_store, intervention_repo, rule_engine, message_generator)

    tasks = [
        health_server(),
        initial_check(data_store, pipeline),
        periodic_check(data_store, pipeline),
    ]

    if hasattr(data_store, "channel"):
        for attempt in range(3):
            try:
                await subscribe_channels(data_store, pipeline)
                logger.info("👂 이벤트 대기 중... (Ctrl+C로 종료)")
                break
            except Exception as e:
                logger.error(f"구독 실패 (시도 {attempt + 1}/3): {e}")
                if attempt == 2:
                    raise
                await asyncio.sleep(5)
        tasks.append(realtime_watchdog(data_store, pipeline))
    else:
        logger.info("👂 RDS polling 모드로 동작합니다. Realtime 구독은 사용하지 않습니다.")

    await asyncio.gather(*tasks)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("\n👋 워커 정상 종료됨")
