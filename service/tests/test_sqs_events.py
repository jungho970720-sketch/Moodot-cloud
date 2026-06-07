import pytest

from events.sqs import SqsEventConsumer


class FakeSqsClient:
    def __init__(self):
        self.deleted = []

    def delete_message(self, QueueUrl, ReceiptHandle):
        self.deleted.append((QueueUrl, ReceiptHandle))


class FakeStore:
    def __init__(self, memory):
        self.memory = memory
        self.requested_ids = []

    async def fetch_memory_by_id(self, memory_id):
        self.requested_ids.append(memory_id)
        return self.memory


class FakePipeline:
    def __init__(self, result):
        self.result = result
        self.payloads = []

    async def process_emotion(self, payload):
        self.payloads.append(payload)
        return self.result


def make_consumer(store, pipeline, client):
    return SqsEventConsumer(
        store,
        pipeline,
        "https://example.com/queue",
        "ap-northeast-2",
        client=client,
        wait_time_seconds=0,
    )


@pytest.mark.asyncio
async def test_handle_memory_created_deletes_on_success():
    memory = {"id": 123, "processed": False}
    store = FakeStore(memory)
    pipeline = FakePipeline(True)
    client = FakeSqsClient()
    consumer = make_consumer(store, pipeline, client)

    deleted = await consumer.handle_message(
        {
            "Body": '{"type":"memory.created","memory_id":123}',
            "ReceiptHandle": "receipt-1",
        }
    )

    assert deleted is True
    assert store.requested_ids == [123]
    assert pipeline.payloads == [{"record": memory}]
    assert client.deleted == [("https://example.com/queue", "receipt-1")]


@pytest.mark.asyncio
async def test_handle_memory_created_keeps_message_on_processing_failure():
    store = FakeStore({"id": 123, "processed": False})
    pipeline = FakePipeline(False)
    client = FakeSqsClient()
    consumer = make_consumer(store, pipeline, client)

    deleted = await consumer.handle_message(
        {
            "Body": '{"type":"memory.created","memory_id":123}',
            "ReceiptHandle": "receipt-1",
        }
    )

    assert deleted is False
    assert client.deleted == []


@pytest.mark.asyncio
async def test_handle_memory_created_deletes_when_already_processed():
    store = FakeStore({"id": 123, "processed": True})
    pipeline = FakePipeline(True)
    client = FakeSqsClient()
    consumer = make_consumer(store, pipeline, client)

    deleted = await consumer.handle_message(
        {
            "Body": '{"type":"memory.created","memory_id":123}',
            "ReceiptHandle": "receipt-1",
        }
    )

    assert deleted is True
    assert pipeline.payloads == []
    assert client.deleted == [("https://example.com/queue", "receipt-1")]


@pytest.mark.asyncio
async def test_invalid_message_is_deleted_as_poison_message():
    store = FakeStore(None)
    pipeline = FakePipeline(True)
    client = FakeSqsClient()
    consumer = make_consumer(store, pipeline, client)

    deleted = await consumer.handle_message(
        {
            "Body": "not-json",
            "ReceiptHandle": "receipt-1",
        }
    )

    assert deleted is True
    assert store.requested_ids == []
    assert client.deleted == [("https://example.com/queue", "receipt-1")]
