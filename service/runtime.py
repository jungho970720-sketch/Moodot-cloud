import logging
import os
from dataclasses import dataclass
from typing import Any

from dotenv import load_dotenv


logger = logging.getLogger(__name__)


def load_worker_env() -> None:
    load_dotenv(".env.local")


def configure_logging() -> None:
    level = os.getenv("LOG_LEVEL", "INFO").upper()
    logging.basicConfig(
        level=level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )
    # Lambda runtime pre-configures the root logger, so basicConfig() is a no-op.
    # Force the level directly so LOG_LEVEL env var is respected in Lambda.
    logging.getLogger().setLevel(level)


@dataclass
class WorkerRuntime:
    store: Any
    pipeline: Any

    async def close(self) -> None:
        await self.store.close()


async def create_runtime() -> WorkerRuntime:
    from config import LLMFactory
    from db import WorkerPostgresStore
    from generators import MessageGenerator
    from models import InterventionRepository
    from rules import RuleEngine
    from agents import Pipeline

    logger.info("📡 Worker data provider: RDS PostgreSQL")
    store = await WorkerPostgresStore.create()
    intervention_repo = InterventionRepository(store)
    rule_engine = RuleEngine(store)

    try:
        llm = LLMFactory.create()
        message_generator = MessageGenerator(llm)
        logger.info("✅ MessageGenerator 초기화 완료 (%s)", llm.model_name)
    except Exception as error:
        message_generator = None
        logger.warning("⚠️ LLM 연결 실패 — 템플릿 메시지로 동작합니다: %s", error)

    pipeline = Pipeline(store, intervention_repo, rule_engine, message_generator)
    return WorkerRuntime(store=store, pipeline=pipeline)
