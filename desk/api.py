"""JSON API + static iPhone app. Every /api call needs APP_TOKEN (Bearer header or ?t=)."""
import asyncio
import hmac
import os
import time

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import links
from agents.executor import balance, free_stack
from config import DEFAULTS, SettingsError

WEB = os.path.join(os.path.dirname(__file__), "web")


def make_app(db, st, ctl, token, executor=None, rpc_url=None):
    app = FastAPI()
    token = (token or "").strip()

    def auth(request: Request):
        got = (request.headers.get("authorization", "").removeprefix("Bearer ") or request.query_params.get("t", "")).strip()
        if not token or not hmac.compare_digest(got.encode(), token.encode()):
            raise HTTPException(401)

    @app.get("/api/state", dependencies=[Depends(auth)])
    def state():
        bal = balance(db, st)
        start = st["desk.paper_start_stack"] if st["desk.mode"] == "PAPER" else st["desk.live_stack"]
        opens = [dict(r) | {"coin_url": links.coin_url(r["mint"]),
                            "last_price": db.last_price(r["mint"])}
                 for r in db.q("SELECT * FROM positions WHERE status IN ('open','exiting') ORDER BY opened_at DESC")]
        today = db.one("SELECT COUNT(*) n, COALESCE(SUM(pnl_usd),0) p FROM positions WHERE status='closed' AND closed_at>?",
                       (time.time() - 86400,))
        return {"running": ctl.active, "since": ctl.since, "mode": st["desk.mode"], "balance": round(bal, 2),
                "free": round(free_stack(db, st), 2), "pnl_24h": round(today["p"], 2), "trades_24h": today["n"],
                "multiplier": round(bal / start, 2) if start else None, "open": opens,
                "agents": {r["agent"]: r["ts"] for r in db.q("SELECT * FROM heartbeats")}}

    @app.post("/api/start", dependencies=[Depends(auth)])
    def start():
        if st["desk.mode"] == "PAPER" and st["executor.below_min"] == "skip" and st.min_stack() > balance(db, st):
            raise HTTPException(400, f"stack under ${st.min_stack():.2f}: every coin would be skipped")
        ctl.start()
        return {"running": True}

    @app.post("/api/stop", dependencies=[Depends(auth)])
    def stop():
        ctl.stop()
        return {"running": False, "open_positions_still_guarded": db.one(
            "SELECT COUNT(*) n FROM positions WHERE status='open'")["n"]}

    @app.get("/api/activity", dependencies=[Depends(auth)])
    def activity(before: float | None = None):
        rows = db.q("SELECT * FROM activity WHERE ts<? ORDER BY ts DESC LIMIT 30", (before or time.time() + 1,))
        return [dict(r) | {"coin_url": links.coin_url(r["mint"])} for r in rows]

    class SetBody(BaseModel):
        key: str
        value: str | float | bool

    @app.get("/api/settings", dependencies=[Depends(auth)])
    def get_settings():
        return {k: {"value": st[k], "min": d[1], "max": d[2]} for k, d in DEFAULTS.items()}

    @app.post("/api/settings", dependencies=[Depends(auth)])
    def set_settings(b: SetBody):
        try:
            old, new = st.set(b.key, b.value, "app")
        except SettingsError as e:
            raise HTTPException(400, str(e))
        return {"old": old, "new": new}

    class ModeBody(BaseModel):
        mode: str
        confirm: str = ""

    @app.post("/api/mode", dependencies=[Depends(auth)])
    def mode(b: ModeBody):
        if b.mode == "LIVE":
            nights = db.one("SELECT COUNT(*) n FROM positions WHERE mode='PAPER' AND status='closed'")["n"]
            if b.confirm != "LIVE" or nights < 1:
                raise HTTPException(400, "LIVE needs typed confirm 'LIVE' and at least 1 closed PAPER trade")
        st.set("desk.mode", b.mode, "app")
        return {"mode": b.mode}

    @app.post("/api/bought/{mint}", dependencies=[Depends(auth)])
    def bought(mint: str):
        if executor:
            executor.on_bought(mint)
        return {"ok": True}

    @app.post("/api/sold/{pid}", dependencies=[Depends(auth)])
    def sold(pid: int):
        db.x("UPDATE positions SET status='closed' WHERE id=? AND status='exiting'", (pid,))
        return {"ok": True}

    job = {"running": False, "result": None, "started": None}

    async def _selftest():
        import selftest as T
        from sources import Sources
        url = rpc_url or st["desk.rpc_url"]
        src = Sources(url)
        try:
            job["result"] = await T.run(src, url)
        except Exception as e:
            job["result"] = {"error": f"{type(e).__name__}: {e}"[:300], "steps": []}
        finally:
            job["running"] = False
            await src.http.aclose()

    @app.post("/api/selftest", dependencies=[Depends(auth)])
    async def selftest_start():
        """Runs in the background: a long request would be cut by the Fly proxy."""
        if not job["running"]:
            job.update(running=True, result=None, started=time.time())
            asyncio.get_running_loop().create_task(_selftest())
        return {"running": True}

    @app.get("/api/selftest", dependencies=[Depends(auth)])
    def selftest_status():
        return job

    @app.get("/healthz")
    def healthz():
        return {"ok": True}

    @app.get("/")
    def index():
        return FileResponse(os.path.join(WEB, "index.html"))

    app.mount("/", StaticFiles(directory=WEB), name="web")
    return app
