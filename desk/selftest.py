"""Live self-test run from the server: checks every data source against the keys the agents read.
Output contains key names and counts only, never secrets."""
import asyncio
import json
import time
from urllib.parse import urlsplit

import fields
from sources import top10_pct

SEARCH = "https://api.dexscreener.com/latest/dex/search?q=pumpswap"


def keys(d, depth=1):
    if not isinstance(d, dict):
        return type(d).__name__
    return {k: (keys(v, depth - 1) if depth > 0 and isinstance(v, dict) else type(v).__name__) for k, v in d.items()}


async def step(name, coro, out, timeout=20):
    t0 = time.time()
    try:
        info = await asyncio.wait_for(coro, timeout)
        out.append({"step": name, "ok": True, "ms": int((time.time() - t0) * 1000), "info": info})
    except Exception as e:
        out.append({"step": name, "ok": False, "ms": int((time.time() - t0) * 1000), "info": f"{type(e).__name__}: {e}"[:300]})


async def run(src, rpc_url):
    out, ctx = [], {}
    u = urlsplit(rpc_url)
    rpc_label = f"{u.scheme}://{u.hostname}"  # no path/query: may hold an API key

    async def dex():
        r = await src.http.get(SEARCH)
        r.raise_for_status()
        pairs = [p for p in r.json().get("pairs", []) if p.get("chainId") == "solana" and p.get("dexId") == "pumpswap"]
        if not pairs:
            raise RuntimeError("no pumpswap pair in search")
        # newest pair = closest to what the desk audits (fresh graduates, few holders)
        pairs.sort(key=lambda p: p.get("pairCreatedAt") or 0, reverse=True)
        ctx["others"] = [q["baseToken"]["address"] for q in pairs[1:8]]
        p = pairs[0]
        ctx["mint"], ctx["pool"] = p["baseToken"]["address"], p.get("pairAddress")
        flat = fields.pair(p)
        return {"mint": ctx["mint"], "pool": ctx["pool"], "missing": [k for k, v in flat.items() if v is None],
                "raw_keys": keys(p)}
    await step("dexscreener search + mapping", dex(), out)
    if "mint" not in ctx:
        return {"rpc": rpc_label, "steps": out}
    mint = ctx["mint"]

    async def dex_batch():
        got = (await src.dex_pairs([mint])).get(mint)
        if not got or not got["price"]:
            raise RuntimeError("tokens/v1 batch returned no pumpswap price")
        return {"price": got["price"], "liq": got["liq"]}
    await step("dexscreener tokens/v1 (what agents use)", dex_batch(), out)

    async def rpc_basic():
        slot = await src.rpc("getSlot", [])
        mi = await src.mint_info(mint)
        return {"slot": slot, "mintAuthority_key": "mintAuthority" in mi, "freezeAuthority_key": "freezeAuthority" in mi,
                "supply_key": "supply" in mi}
    await step("rpc getSlot + mint info (layers 1-2)", rpc_basic(), out)

    async def gpa_top10():
        acc = await src.token_accounts(mint)
        mi = await src.mint_info(mint)
        return {"token_accounts": len(acc), "holders": sum(1 for _, _, a in acc if a > 0),
                "with_delegate": sum(1 for _, d, _ in acc if d),
                "top10_pct_ex_pool": round(top10_pct(acc, int(mi["supply"]), {ctx["pool"]}), 2)}
    await step("rpc getProgramAccounts (layers 4, 8)", gpa_top10(), out, timeout=40)

    async def rug():
        rep = await src.rugcheck(mint)
        mk = rep.get("markets") or []
        return {"top_keys": sorted(rep.keys())[:60], "creator_found": fields.rug_creator(rep) is not None,
                "markets": len(mk), "market_keys": keys(mk[0], 1) if mk else None,
                "lp_locked_pct_mapped": fields.rug_lp_locked_pct(rep, ctx["pool"])}
    await step("rugcheck report (layers 3, 5)", rug(), out)

    async def graph():
        # look across several recent coins for a non-empty graph, to see its real shape
        seen = []
        for m in [mint] + ctx.get("others", []):
            g = await src.rug_graph(m)
            seen.append({"mint": m, "type": type(g).__name__, "len": len(g) if hasattr(g, "__len__") else None,
                         "bundled_size": fields.bundled_size(g)})
            if g:
                return {"checked": seen, "sample": json.dumps(g)[:1500]}
            await asyncio.sleep(0.3)
        return {"checked": seen, "sample": "all empty"}
    await step("rugcheck insiders graph (layer 7)", graph(), out, timeout=40)

    async def pumpportal():
        import websockets
        async with websockets.connect("wss://pumpportal.fun/api/data") as ws:
            await ws.send(json.dumps({"method": "subscribeMigration"}))
            msgs = []
            end = time.time() + 90
            while time.time() < end and not any("mint" in m for m in msgs):
                try:
                    msgs.append(json.loads(await asyncio.wait_for(ws.recv(), end - time.time())))
                except asyncio.TimeoutError:
                    break
            mig = [m for m in msgs if "mint" in m]
            return {"messages": len(msgs), "first_keys": [sorted(m.keys()) for m in msgs],
                    "raw_pool": mig[0].get("pool") if mig else None,
                    "mapped": fields.migration(mig[0]) if mig else "no migration in 90s (normal if quiet)"}
    await step("pumpportal migration stream", pumpportal(), out, timeout=100)

    return {"rpc": rpc_label, "mint": mint, "steps": out}
