import asyncio
import logging
import time

import fees
import links
from sources import RateLimited

log = logging.getLogger("risk")


def evaluate(pos, price, st, now):
    """Pure rule check. pos: dict with entry_price, peak_price, stop_pct, trail_active, opened_at.
    -> (new_peak, trail_active, exit_reason|None). Rule order: peak, stop, trail on, trail, timeout."""
    entry = pos["entry_price"]
    peak = max(pos["peak_price"], price)
    if price <= entry * (1 - pos["stop_pct"] / 100):
        return peak, pos["trail_active"], "stop"
    trail = bool(pos["trail_active"]) or price >= entry * (1 + st["risk.trail_start_pct"] / 100)
    if trail and price <= peak * (1 - st["risk.trail_pct"] / 100):
        return peak, trail, "trail"
    if (now - pos["opened_at"]) >= st["risk.timeout_h"] * 3600 and \
            price < entry * (1 + st["risk.timeout_min_gain_pct"] / 100):
        return peak, trail, "timeout"
    return peak, trail, None


def effective_stop(old_stop_pct, new_setting):
    """A new stop setting applies to open positions only if tighter."""
    return min(old_stop_pct, new_setting)


class Risk:
    def __init__(self, st, db, bus, src, notifier):
        self.st, self.db, self.bus, self.src, self.n = st, db, bus, src, notifier
        self.misses = {}

    async def poll(self, now=None):
        now = now or time.time()
        rows = self.db.q("SELECT * FROM positions WHERE status='open'")
        if not rows:
            return
        pairs = await self.src.dex_pairs([r["mint"] for r in rows])
        for r in rows:
            pos = dict(r)
            # tighten only
            tight = effective_stop(pos["stop_pct"], self.st["risk.stop_pct"])
            if tight != pos["stop_pct"]:
                pos["stop_pct"] = tight
                self.db.x("UPDATE positions SET stop_pct=? WHERE id=?", (tight, pos["id"]))
            p = pairs.get(pos["mint"])
            if not p or not p["price"]:
                self.misses[pos["id"]] = self.misses.get(pos["id"], 0) + 1
                if self.misses[pos["id"]] == 4:
                    await self.n.push(f"{pos['name']}: no price for 1 min",
                                      [("Sell on FOMO", links.coin_url(pos["mint"]), None)], pos["mode"])
                continue
            self.misses[pos["id"]] = 0
            price = p["price"]
            self.db.price(pos["mint"], price, p["vol_m5"], p["liq"])
            reason = None
            if p["liq"] == 0:
                reason, peak, trail = "pulled", max(pos["peak_price"], price), pos["trail_active"]
            else:
                peak, trail, reason = evaluate(pos, price, self.st, now)
            self.db.x("UPDATE positions SET peak_price=?, trail_active=? WHERE id=?", (peak, int(trail), pos["id"]))
            if reason:
                await self.exit(pos, price, reason, peak)

    async def exit(self, pos, price, reason, peak):
        d = self.st["desk.fees_ref_discount"]
        qty_value = pos["size_usd"] * price / pos["entry_price"]
        fee = fee_total = fees.fee_usd(pos["size_usd"], d) + fees.fee_usd(qty_value, d)
        pnl = round(qty_value - pos["size_usd"] - fee_total, 2)
        pct = round(100 * (price / pos["entry_price"] - 1), 1)
        live = pos["mode"] == "LIVE"
        status = "exiting" if live else "closed"
        self.db.x("UPDATE positions SET exit_price=?, exit_reason=?, pnl_usd=?, fees_usd=?, status=?, closed_at=? WHERE id=?",
                  (price, reason, pnl, round(fee_total, 4), status, time.time(), pos["id"]))
        name = pos["name"]
        sub = {"stop": f"Risk · -{pos['stop_pct']:g}% stop", "trail": "Risk · trailing stop",
               "timeout": "Risk · timeout", "pulled": "Risk · liquidity pulled"}[reason]
        kind = "sold" if reason == "trail" or pnl > 0 else "stopped"
        self.db.activity(kind, pos["mint"], "risk", f"{'Sold' if kind == 'sold' else 'Stopped'} {name}", sub,
                         f"{'+' if pnl >= 0 else '-'}${abs(pnl):.2f}")
        if reason == "stop":
            text = f"{name} hit the -{pos['stop_pct']:g}% stop · -${abs(pnl):.2f}"
        elif reason == "timeout":
            text = f"Sell {name}, dead money · {pct}% in {self.st['risk.timeout_h']:g}h"
        elif reason == "pulled":
            text = f"{name}: liquidity pulled · sell now"
        else:
            text = f"Sold {name} · {'+' if pnl >= 0 else '-'}${abs(pnl):.2f} ({pct:+}%)"
        btns = [("Sell on FOMO", links.coin_url(pos["mint"]), None)]
        if live:
            btns.append(("Sold", None, f"sold:{pos['id']}"))
        await self.n.push(text, btns, pos["mode"])
        self.bus.emit("exit", {"mint": pos["mint"], "reason": reason, "pnl": pnl})

    async def run(self):
        while True:
            try:
                await self.poll()
            except RateLimited:
                await asyncio.sleep(30)
            except Exception:
                log.exception("risk")
            self.db.beat("risk")
            await asyncio.sleep(self.st["risk.poll_s"])
