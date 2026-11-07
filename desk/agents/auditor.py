import asyncio
import logging
import time
from collections import defaultdict

import fields
from sources import top10_pct

log = logging.getLogger("auditor")
NAMES = ["Mint authority", "Freeze authority", "Dev wallet", "Top 10 holders", "Liquidity",
         "Pool age", "Bundled wallets", "Delegations"]


class Auditor:
    def __init__(self, st, db, bus, src):
        self.st, self.db, self.bus, self.src = st, db, bus, src
        self.done = set()

    async def _retry(self, fn, *a):
        n = self.st["auditor.retries"]
        for i in range(n + 1):
            try:
                return await fn(*a)
            except Exception as e:
                if i == n:
                    raise
                await asyncio.sleep(2)

    async def audit(self, scan):
        mint, s = scan["mint"], self.st
        coin = self.db.one("SELECT * FROM coins WHERE mint=?", (mint,))
        ctx = {"supply": None, "holders": None, "mint_info": None, "rug": None, "accts": None}

        async def accounts():
            # one getProgramAccounts per audit, shared by layers 4, 7 and 8
            if ctx["accts"] is None:
                ctx["accts"] = await self._retry(self.src.token_accounts, mint)
            return ctx["accts"]
        layers = []
        reason = None

        async def run_layer(n, fn):
            nonlocal reason
            t0 = time.time()
            try:
                ok, value, src = await fn()
            except Exception as e:
                ok, value, src = False, f"no data: {NAMES[n-1].lower()}", "rpc"
                log.warning("layer %s error %s", n, e)
            layers.append({"n": n, "name": NAMES[n - 1], "pass": ok, "value": value, "source": src,
                           "ms": int((time.time() - t0) * 1000)})
            self.db.x("INSERT INTO audits(mint,ts,layer,name,value_text,pass,source) VALUES(?,?,?,?,?,?,?)",
                      (mint, time.time(), n, NAMES[n - 1], value, int(ok), src))
            self.bus.emit("audit_layer", {"mint": mint, **layers[-1]})
            if not ok:
                reason = value
            return ok

        async def L1():
            ctx["mint_info"] = await self._retry(self.src.mint_info, mint)
            ok = ctx["mint_info"].get("mintAuthority") is None
            return ok, "Revoked" if ok else "mint not revoked", "rpc"

        async def L2():
            ok = ctx["mint_info"].get("freezeAuthority") is None
            return ok, "Revoked" if ok else "freeze not revoked", "rpc"

        async def L3():
            info = ctx["mint_info"]
            supply = float(info.get("supply", 0)) / (10 ** int(info.get("decimals", 0)))
            ctx["supply"] = supply
            if supply <= 0:
                return False, "no supply", "rpc"
            creator = coin["creator"] if coin else None
            if not creator:
                return False, "no data: dev", "rpc"
            bal = await self._retry(self.src.owner_balance, creator, mint)
            start = coin["creator_balance_at_migration"]
            pct = 100 * bal / supply
            if start is not None and bal < start * 0.999:
                return False, "dev sold", "rpc"
            if pct >= s["auditor.max_dev_pct"]:
                return False, f"dev holds {pct:.0f}%", "rpc"
            return True, f"{pct:.1f}% · sold 0", "rpc"

        async def L4():
            pct = top10_pct(await accounts(), int(ctx["mint_info"]["supply"]), {scan.get("pool")})
            if pct is None:
                return False, "no data: top 10 holders", "rpc"
            ok = pct < s["auditor.max_top10_pct"]
            return ok, f"{pct:.1f}%" if ok else f"top 10 hold {pct:.0f}%", "rpc"

        async def L5():
            ctx["rug"] = await self._retry(self.src.rugcheck, mint)
            lp = fields.rug_lp_locked_pct(ctx["rug"], scan.get("pool"))
            if lp is None:
                return False, "no data: liquidity", "rugcheck"
            now_liq = None
            ok = lp >= s["auditor.min_lp_locked_pct"]
            liq0 = scan.get("liquidityUsd")
            p = (await self.src.dex_pairs([mint])).get(mint)
            if p and liq0 and p["liq"] is not None and p["liq"] < liq0 * 0.5:
                return False, "liquidity pulled", "rugcheck"
            return ok, f"{lp:.0f}% burned/locked" if ok else "liquidity unlocked", "rugcheck"

        async def L6():
            age = (time.time() - coin["migrated_at"]) / 60 if coin else 0
            ok = age >= s["auditor.min_pool_age_min"]
            return ok, f"{age:.0f}m" if ok else "pool too young", "rpc"

        async def L7():
            g = await self._retry(self.src.rug_graph, mint)
            holders = {o for o, _, a in await accounts() if a > 0}
            size = fields.bundled_size(g, holders)
            if size is None:
                log.warning("unrecognised insiders graph for %s: %s", mint, str(g)[:300])
                return False, "no data: bundles", "rugcheck"
            ok = size < s["auditor.max_bundled"]
            return ok, "None" if size <= 1 else (f"{size} bundled" if ok else f"{size} bundled wallets"), "rugcheck"

        async def L8():
            accts = await accounts()
            by = defaultdict(int)
            n_holders = 0
            for owner, delegate, amt in accts:
                if amt > 0:
                    n_holders += 1
                if delegate:
                    by[delegate] += 1
            self.db.x("UPDATE coins SET holders=? WHERE mint=?", (n_holders, mint))
            worst = max(by.items(), key=lambda kv: kv[1], default=(None, 0))
            if worst[1] >= s["auditor.max_delegated_accounts"]:
                d = worst[0]
                return False, f"{worst[1]} wallets → {d[:4]}...{d[-3:]}", "rpc"
            return True, "None", "rpc"

        passed = True
        for n, fn in enumerate([L1, L2, L3, L4, L5, L6, L7, L8], 1):
            if not await run_layer(n, fn):
                passed = False
                for k in range(n + 1, 9):
                    layers.append({"n": k, "name": NAMES[k - 1], "pass": None, "value": "not checked", "source": None})
                break
        out = {"agent": "auditor", "mint": mint, "ts": time.time(), "passed": passed,
               "layersChecked": sum(1 for l in layers if l["pass"] is not None), "layers": layers,
               "reason": reason}
        if passed:
            self.bus.analyst.put_nowait({"scan": scan, "audit": out})
        else:
            name = scan.get("name") or mint[:6]
            self.db.activity("rejected", mint, "auditor", f"Rejected {name}", f"Auditor · {reason}", "Skipped")
        self.bus.emit("verdict_audit", out)
        return out

    async def run(self):
        while True:
            scan = await self.bus.auditor.get()
            self.db.beat("auditor")
            if scan["mint"] in self.done or not self.st["auditor.enabled"]:
                if not self.st["auditor.enabled"]:
                    self.bus.analyst.put_nowait({"scan": scan, "audit": None})
                continue
            self.done.add(scan["mint"])
            try:
                await self.audit(scan)
            except Exception:
                log.exception("audit failed")
