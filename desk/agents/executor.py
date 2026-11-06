import asyncio
import logging
import time

import links

log = logging.getLogger("executor")


def balance(db, st):
    """PAPER: simulated balance = start + realised pnl. LIVE: user-set stack."""
    if st["desk.mode"] == "LIVE":
        return st["desk.live_stack"]
    r = db.one("SELECT COALESCE(SUM(pnl_usd),0) s FROM positions WHERE status='closed' AND mode='PAPER'")
    return st["desk.paper_start_stack"] + r["s"]


def free_stack(db, st):
    open_ = db.one("SELECT COALESCE(SUM(size_usd),0) s FROM positions WHERE status IN ('open','exiting') AND mode=?",
                   (st["desk.mode"],))["s"]
    return balance(db, st) - open_


def size_ticket(stack, free, liq, st):
    """-> (size, reason). Pure arithmetic."""
    size = stack * st["executor.stack_pct"] / 100
    if liq is not None:
        size = min(size, liq * st["executor.max_pool_pct"] / 100)
    mn = st["executor.min_ticket_usd"]
    if size < mn:
        if st["executor.below_min"] == "skip":
            return None, f"under ${mn}"
        size = mn
    if size > free:
        return None, "no free stack"
    return round(size, 2), None


class Executor:
    def __init__(self, st, db, bus, src, notifier):
        self.st, self.db, self.bus, self.src, self.n = st, db, bus, src, notifier
        self.seen = set()
        self.pending = {}  # mint -> signal dict (LIVE awaiting tap)

    async def handle(self, a):
        st, mint = self.st, a["mint"]
        scan = a["scan"]
        name = scan.get("name") or mint[:6]
        p = (await self.src.dex_pairs([mint])).get(mint)
        if not p or not p["price"]:
            return self._skip(mint, name, "no price")
        liq0 = scan.get("liquidityUsd")
        if liq0 and p["liq"] is not None and p["liq"] < liq0 * (1 - st["executor.recheck_liq_drop_pct"] / 100):
            return self._skip(mint, name, "liquidity dropping")
        p0 = a["pair"]["price"]
        if p0 and p["price"] > p0 * (1 + st["executor.recheck_price_up_pct"] / 100):
            return self._skip(mint, name, "ran before the push")
        stack = balance(self.db, st)
        size, why = size_ticket(stack, free_stack(self.db, st), p["liq"], st)
        if size is None:
            return self._skip(mint, name, why)
        pct = round(100 * size / stack, 1)
        mode = st["desk.mode"]
        link = links.coin_url(mint, "solana")
        sid = self.db.x("INSERT INTO signals(mint,ts,price,size_usd,stack_pct,link,mode,status) VALUES(?,?,?,?,?,?,?,?)",
                        (mint, time.time(), p["price"], size, pct, link, mode, "sent"))
        text = (f"Buy {name} · ${size} · {pct}% of stack\nAuditor 8/8 · Analyst {a['score']} · "
                f"stop -{st['risk.stop_pct']}% · trail {st['risk.trail_pct']}%")
        await self.n.push(text, [("Buy on FOMO", link, None), ("Bought", None, f"bought:{mint}"),
                                 ("Skip", None, f"skip:{mint}")], mode)
        sig = {"id": sid, "mint": mint, "name": name, "price": p["price"], "size": size, "pct": pct, "ts": time.time()}
        if mode == "PAPER":
            await asyncio.sleep(0)  # PAPER fills at once at the signal price
            self.fill(sig)
        else:
            self.pending[mint] = sig
            asyncio.get_event_loop().call_later(st["executor.confirm_window_min"] * 60, self._missed, mint)
        return sig

    def _skip(self, mint, name, why):
        self.db.activity("rejected", mint, "executor", f"Rejected {name}", f"Executor · {why}", "Skipped")
        log.info("skip %s %s", mint, why)
        return None

    def _missed(self, mint):
        if self.pending.pop(mint, None):
            self.db.x("UPDATE signals SET status='missed' WHERE mint=?", (mint,))

    def on_bought(self, mint):
        sig = self.pending.pop(mint, None)
        if sig:
            self.fill(sig)

    def on_skip(self, mint):
        self.pending.pop(mint, None)
        self.db.x("INSERT OR REPLACE INTO skips VALUES(?,?)", (mint, time.time() + 86400))

    def fill(self, sig):
        st = self.st
        self.db.x("UPDATE signals SET status='bought' WHERE id=?", (sig["id"],))
        pid = self.db.x(
            "INSERT INTO positions(mint,name,opened_at,entry_price,size_usd,peak_price,stop_pct,mode,status)"
            " VALUES(?,?,?,?,?,?,?,?,'open')",
            (sig["mint"], sig["name"], time.time(), sig["price"], sig["size"], sig["price"],
             st["risk.stop_pct"], st["desk.mode"]))
        self.db.activity("bought", sig["mint"], "executor", f"Bought {sig['name']}",
                         f"Executor · {time.strftime('%H:%M')}", f"${sig['size']} · {sig['pct']}% of stack")
        self.bus.emit("fill", {"position": pid, "mint": sig["mint"]})
        return pid

    async def run(self):
        while True:
            a = await self.bus.executor.get()
            self.db.beat("executor")
            if a["mint"] in self.seen:
                continue
            self.seen.add(a["mint"])
            try:
                await self.handle(a)
            except Exception:
                log.exception("executor")
