import pytest

import lambda_handler


class FakeConsumer:
    def __init__(self, outcomes):
        self.outcomes = outcomes
        self.records = []

    async def handle_lambda_record(self, record):
        self.records.append(record)
        return self.outcomes.pop(0)


class FakeRuntime:
    def __init__(self):
        self.store = object()
        self.pipeline = object()
        self.closed = False

    async def close(self):
        self.closed = True


@pytest.mark.asyncio
async def test_handle_sqs_event_reports_batch_failures(monkeypatch):
    runtime = FakeRuntime()
    consumer = FakeConsumer([True, False])

    async def fake_create_runtime():
        return runtime

    monkeypatch.setattr(lambda_handler, "create_runtime", fake_create_runtime)
    monkeypatch.setattr(
        lambda_handler.SqsEventConsumer,
        "from_env",
        lambda store, pipeline: consumer,
    )

    result = await lambda_handler._handle_sqs_event(
        {
            "Records": [
                {"eventSource": "aws:sqs", "messageId": "ok-1", "body": "{}"},
                {"eventSource": "aws:sqs", "messageId": "fail-1", "body": "{}"},
            ]
        }
    )

    assert result == {"batchItemFailures": [{"itemIdentifier": "fail-1"}]}
    assert len(consumer.records) == 2
    assert runtime.closed is True


@pytest.mark.asyncio
async def test_handle_sqs_event_ignores_non_sqs_records(monkeypatch):
    runtime = FakeRuntime()
    consumer = FakeConsumer([])

    async def fake_create_runtime():
        return runtime

    monkeypatch.setattr(lambda_handler, "create_runtime", fake_create_runtime)
    monkeypatch.setattr(
        lambda_handler.SqsEventConsumer,
        "from_env",
        lambda store, pipeline: consumer,
    )

    result = await lambda_handler._handle_sqs_event(
        {"Records": [{"eventSource": "aws:s3", "messageId": "skip-1", "body": "{}"}]}
    )

    assert result == {"batchItemFailures": []}
    assert consumer.records == []
    assert runtime.closed is True
