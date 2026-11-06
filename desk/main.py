"""One asyncio process: agents + notifier. Run:  cd desk && python main.py"""
import asyncio
import logging
import os

from agents.analyst import Analyst
from agents.auditor import Auditor
from agents.executor import Executor
from agents.risk import Risk
from agents.scanner import Scanner
from bus import Bus
from config import Settings
from db import DB
from notifier import Notifier
from sources import Sources


async def amain():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    db = DB(os.environ.get("DESK_DB", "desk.sqlite"))
    st = Settings(db)
    if os.environ.get("TYPESAFE_API_KEY"):
        st.set("analyst.mode", "jev", "boot")
    src = Sources(st["desk.rpc_url"])
    bus = Bus()
    n = Notifier(os.environ.get("TG_TOKEN"), os.environ.get("TG_CHAT_ID"))
    if st["desk.mode"] == "PAPER" and st["executor.below_min"] == "skip" and st.min_stack() > st["desk.paper_start_stack"]:
        await n.push(f"Every coin will be skipped: stack under ${st.min_stack():.2f}. Switch to bump or raise the stack.")
    agents = [Scanner(st, db, bus, src), Auditor(st, db, bus, src), Analyst(st, db, bus, src),
              Executor(st, db, bus, src, n), Risk(st, db, bus, src, n)]
    await asyncio.gather(*(a.run() for a in agents))


if __name__ == "__main__":
    asyncio.run(amain())
