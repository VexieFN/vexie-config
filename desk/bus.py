import asyncio


class Bus:
    def __init__(self):
        self.auditor = asyncio.Queue()
        self.analyst = asyncio.Queue()
        self.executor = asyncio.Queue()
        self.risk = asyncio.Queue()
        self.events = []  # SSE subscribers: list[asyncio.Queue]

    def emit(self, kind, data):
        for q in list(self.events):
            q.put_nowait({"kind": kind, "data": data})
