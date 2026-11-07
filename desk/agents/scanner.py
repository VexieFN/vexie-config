import asyncio
import json
import logging
import re
import time

import fields
from sources import RateLimited, top10_pct

log = logging.getLogger("scanner")
WS = "wss://pumpportal.fun/api/data"


def norm(s):
    return re.sub(r"[^a-z]", "", (s or "").lower())


class Scanner:
    def __init__(self, st, db, bus, src, ctl=None):
        self.st, self.db, self.bus, self.src = st, db, bus, src
        self.ctl = ctl
        self.room = {}   # mint -> dict
        self.sent = set()
        self.runners = set()  # normalized names that ran today
        self.reconnects = 0

    # ---- intake
    async def on_migration(self, msg):
        m = fields.migration(msg)
        mint = m["mint"]
        if not mint or mint in self.room or mint in self.sent:
            return
        creator = m["creator"]
        bal = None
        if creator is None:
            try:
                creator = fields.rug_creator(await self.src.rugcheck(mint))
            except Exception as e:  # noqa
                log.warning("creator lookup failed %s", e)
        if creator:
            try:
                bal = await self.src.owner_balance(creator, mint)
            except Exception:
                bal = None
        now = time.time()
        self.room[mint] = {**m, "creator": creator, "migrated_at": now}
        self.db.x("INSERT OR REPLACE INTO coins(mint,name,symbol,pool,migrated_at,creator,creator_balance_at_migration)"
                  " VALUES(?,?,?,?,?,?,?)", (mint, m["name"], m["symbol"], m["pool"], now, creator, bal))

    # ---- evaluation (pure given pair + holders)
    def judge(self, mint, room, p, top10, now):
        s = self.st
        age = (now - room["migrated_at"]) / 60
        liq = p.get("liq")
        if liq is not None and liq < s["scanner.min_liquidity_usd"]:
            return "kill", f"liq ${liq/1000:.1f}K", age
        if top10 is not None and top10 > s["scanner.max_top10_pct"]:
            return "kill", f"top 10 hold {top10:.0f}%", age
        ch = p.get("ch_h1")
        if ch is not None and ch > s["scanner.max_h1_change_pct"]:
            return "kill", f"+{ch:.0f}% in 1h", age
        n = norm(p.get("name")) or norm(p.get("symbol"))
        if n and any(r and (r == n or r in n or n in r) for r in self.runners):
            return "kill", "copycat of runner", age
        if age >= s["scanner.min_pool_age_min"] and liq is not None:
            return "pass", None, age
        return "wait", None, age

    async def _top10(self, mint, room):
        info = await self.src.mint_info(mint)
        accts = await self.src.token_accounts(mint)
        return top10_pct(accts, int(info["supply"]), {room.get("pool")})

    async def _ensure_creator(self, mint, room):
        if room.get("creator"):
            return
        try:
            creator = fields.rug_creator(await self.src.rugcheck(mint))
        except Exception:
            return
        if creator:
            room["creator"] = creator
            try:
                bal = await self.src.owner_balance(creator, mint)
            except Exception:
                bal = None
            self.db.x("UPDATE coins SET creator=?, creator_balance_at_migration=? WHERE mint=?", (creator, bal, mint))

    async def tick(self):
        if not self.room:
            return
        s = self.st
        now = time.time()
        pairs = await self.src.dex_pairs(list(self.room))
        for mint, room in list(self.room.items()):
            p = pairs.get(mint)
            age = (now - room["migrated_at"]) / 60
            if not p:
                if age > s["scanner.max_wait_min"]:
                    self._finish(mint, room, "kill", "never qualified", {}, None, age)
                continue
            if p["price"]:
                self.db.price(mint, p["price"], p["vol_m5"], p["liq"])
            if (p.get("ch_h24") or 0) >= s["scanner.runner_h24_pct"]:
                self.runners.add(norm(p.get("name")))
            if p.get("pair") and room.get("pool") != p["pair"]:
                room["pool"] = p["pair"]  # real PumpSwap pool address
                self.db.x("UPDATE coins SET pool=? WHERE mint=?", (p["pair"], mint))
            await self._ensure_creator(mint, room)
            # cheap checks first; the RPC-heavy top 10 only when the coin would otherwise pass
            verdict, reason, age = self.judge(mint, room, p, None, now)
            top10 = None
            if verdict == "pass":
                try:
                    top10 = await self._top10(mint, room)
                except Exception as e:
                    log.warning("top10 failed %s: %s", mint, e)
                    continue  # retry next tick, never pass without it
                verdict, reason, age = self.judge(mint, room, p, top10, now)
            if verdict == "wait":
                if age > s["scanner.max_wait_min"]:
                    self._finish(mint, room, "kill", "never qualified", p, top10, age)
                continue
            self._finish(mint, room, verdict, reason, p, top10, age)

    def _finish(self, mint, room, verdict, reason, p, top10, age):
        self.room.pop(mint, None)
        self.sent.add(mint)
        out = {"agent": "scanner", "mint": mint, "name": p.get("name") or room.get("name"),
               "symbol": p.get("symbol") or room.get("symbol"), "pool": room.get("pool"),
               "liquidityUsd": p.get("liq"), "top10Pct": top10, "h1ChangePct": p.get("ch_h1"),
               "ageMin": int(age), "verdict": verdict, "reason": reason, "ts": time.time()}
        self.db.x("INSERT INTO scans(mint,ts,liquidity_usd,top10_pct,h1_change_pct,age_min,verdict,reason)"
                  " VALUES(?,?,?,?,?,?,?,?)",
                  (mint, out["ts"], out["liquidityUsd"], top10, out["h1ChangePct"], age, verdict, reason))
        if p.get("name"):
            self.db.x("UPDATE coins SET name=?, symbol=? WHERE mint=?", (out["name"], out["symbol"], mint))
        log.info("%s %s %s", mint, verdict, reason)
        self.bus.emit("scan", out)
        if verdict == "pass":
            self.bus.auditor.put_nowait(out)

    def on(self):
        return self.ctl is None or self.ctl.active

    # ---- loops
    async def ws_loop(self):
        import websockets
        backoff = 1
        while True:
            if not self.on():
                await asyncio.sleep(2)
                continue
            try:
                async with websockets.connect(WS) as ws:
                    await ws.send(json.dumps({"method": "subscribeMigration"}))
                    backoff, last = 1, time.time()
                    while self.on():
                        try:
                            raw = await asyncio.wait_for(ws.recv(), timeout=5)
                        except asyncio.TimeoutError:
                            if time.time() - last > 120:
                                raise
                            continue
                        last = time.time()
                        self.db.beat("scanner")
                        try:
                            await self.on_migration(json.loads(raw))
                        except Exception:
                            log.exception("bad migration msg")
            except Exception as e:
                self.reconnects += 1
                log.warning("ws closed (%s), retry in %ss", e, backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60)

    async def poll_loop(self):
        while True:
            try:
                if self.on():
                    await self.tick()
                else:
                    self.room.clear()   # OFF means no new signals at all
            except RateLimited:
                await asyncio.sleep(30)
            except Exception:
                log.exception("scanner tick")
            self.db.beat("scanner")
            await asyncio.sleep(self.st["scanner.poll_s"])

    async def run(self):
        await asyncio.gather(self.ws_loop(), self.poll_loop())
