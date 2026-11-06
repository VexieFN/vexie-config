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
from control import Control
from telegram import Telegram
from api import make_app


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
    ctl = Control(db)                       # always boots OFF
    ex = Executor(st, db, bus, src, n)
    agents = [Scanner(st, db, bus, src, ctl), Auditor(st, db, bus, src), Analyst(st, db, bus, src), ex,
              Risk(st, db, bus, src, n)]
    tasks = [a.run() for a in agents]
    if os.environ.get("TG_TOKEN"):
        n.chat_id = n.chat_id or db.kv_get("owner_chat_id")
        tg = Telegram(os.environ["TG_TOKEN"], db, st, ctl, n, ex)
        tasks.append(tg.run())
    token = os.environ.get("APP_TOKEN")
    if token:
        import uvicorn
        app = make_app(db, st, ctl, token, ex)
        cfg = uvicorn.Config(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)), log_level="warning")
        tasks.append(uvicorn.Server(cfg).serve())
    else:
        logging.warning("APP_TOKEN not set: iPhone app disabled")
    logging.info("Desk ready. OFF until you send /on or tap AVVIA.")
    await asyncio.gather(*tasks)


if __name__ == "__main__":
    asyncio.run(amain())
