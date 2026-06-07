# config/ollama_provider.py
"""
Ollama 로컬 LLM 프로바이더
"""
import os
import time
import logging
import ollama as ollama_client

from .base_llm import BaseLLMProvider

logger = logging.getLogger(__name__)


class OllamaProvider(BaseLLMProvider):
    """Ollama 로컬 LLM 프로바이더"""

    DEFAULT_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:latest")
    BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

    def __init__(
        self,
        model: str = None,
        temperature: float = 0.5,
        num_predict: int = 100,
    ):
        model = model or self.DEFAULT_MODEL

        if not self.check_server():
            raise ConnectionError(
                "Ollama 서버에 연결할 수 없습니다.\n"
                "다음 명령어로 시작하세요: ollama serve"
            )
        if not self.check_model(model):
            raise ValueError(
                f"모델 '{model}'를 찾을 수 없습니다.\n"
                f"다음 명령어로 다운로드하세요: ollama pull {model}"
            )

        self._client = ollama_client.Client(host=self.BASE_URL)
        self._model = model
        self._temperature = temperature
        self._num_predict = num_predict
        logger.info(f"✅ OllamaProvider 초기화: model={model}, temp={temperature}")

    @property
    def model_name(self) -> str:
        return self._model

    def generate(self, prompt: str) -> tuple[str, dict]:
        start = time.time()

        response = self._client.generate(
            model=self._model,
            prompt=prompt,
            options={
                "temperature": self._temperature,
                "num_predict": self._num_predict,
            },
        )
        text = response.get("response", "")

        elapsed = time.time() - start
        prompt_tokens = len(prompt.split())
        completion_tokens = len(text.split())

        usage = {
            "elapsed_time": elapsed,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
            "total_cost": 0.0,  # 로컬이라 비용 없음
        }

        logger.info(f"💬 Ollama 호출 완료: {elapsed:.2f}초, ~{usage['total_tokens']} 토큰")
        return text, usage

    # ── Ollama 전용 유틸리티 ──────────────────────────────────────────────────

    @classmethod
    def check_server(cls) -> bool:
        """Ollama 서버 연결 확인"""
        try:
            ollama_client.Client(host=cls.BASE_URL).list()
            return True
        except Exception as e:
            logger.error(f"❌ Ollama 서버 연결 실패: {e}")
            return False

    @classmethod
    def check_model(cls, model: str) -> bool:
        """로컬에 모델이 존재하는지 확인"""
        try:
            response = ollama_client.Client(host=cls.BASE_URL).list()
            names = [m.model for m in response.models]
            return model in names
        except Exception as e:
            logger.error(f"❌ 모델 확인 실패: {e}")
            return False

    @classmethod
    def list_models(cls) -> list[str]:
        """로컬에 다운로드된 모델 목록"""
        try:
            response = ollama_client.Client(host=cls.BASE_URL).list()
            return [m.model for m in response.models]
        except Exception as e:
            logger.error(f"❌ 모델 목록 조회 실패: {e}")
            return []
