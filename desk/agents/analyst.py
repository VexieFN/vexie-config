import logging
import os
import time

import httpx

import fields

log = logging.getLogger("analyst")


def clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def rules_answers(p, bundled, s):
    alive = clamp((p.get("vol_h1") or 0) / s["analyst.alive_volume_h1"])
    organic = clamp((p.get("buys_h1") or 0) / s["analyst.organic_buys_h1"])
    if bundled >= 3:
        organic *= s["analyst.bundled_penalty"]
    m5 = p.get("ch_m5") or 0
    if m5 <= -s["analyst.flush_drop_m5_pct"] and (p.get("buys_m5") or 0) >= (p.get("sells_m5") or 0):
        flush = 1.0
    elif m5 < 0:
        flush = 0.5
    else:
        flush = 0.0
    chase = clamp((p.get("ch_h1") or 0) / s["analyst.chase_h1_pct"])
    return {"alive_6h": alive, "organic": organic, "flush": flush, "chase": chase}


def gate(a, s):
    score = round(100 * (a["alive_6h"] + a["organic"] + a["flush"] + (1 - a["chase"])) / 4)
    failed = []
    if a["alive_6h"] < s["analyst.min_alive_6h"]:
        failed.append(f"alive_6h {a['alive_6h']:.2f}")
    if a["organic"] < s["analyst.min_organic"]:
        failed.append(f"organic {a['organic']:.2f}")
    if a["chase"] > s["analyst.max_chase"]:
        failed.append(f"chase {a['chase']:.2f}")
    if score < s["analyst.min_score"]:
        failed.append(f"score {score}")
    return score, failed


def build_state(scan, p, audit):
    L = {l["n"]: l["value"] for l in (audit or {}).get("layers", [])}
    return (f"Coin {scan.get('name')} on Solana, graduated {scan.get('ageMin')} min ago. "
            f"Liquidity ${p.get('liq')}. Market cap ${p.get('mcap')}. "
            f"Last 5 min: {p.get('buys_m5')} buys, {p.get('sells_m5')} sells, volume ${p.get('vol_m5')}, price {p.get('ch_m5')}%. "
            f"Last 1h: {p.get('buys_h1')} buys, {p.get('sells_h1')} sells, volume ${p.get('vol_h1')}, price {p.get('ch_h1')}%. "
            f"Top 10 hold {L.get(4)}. Dev holds {L.get(3)}. LP {L.get(5)}. Bundled {L.get(7)}. Delegations {L.get(8)}.")[:3000]


class Analyst:
    def __init__(self, st, db, bus, src):
        self.st, self.db, self.bus, self.src = st, db, bus, src
        self.seen = set()
        self.http = httpx.AsyncClient(timeout=st["analyst.timeout_s"])

    async def jev(self, state):
        key = os.environ.get("TYPESAFE_API_KEY")
        body = {"model": "jev-latest", "state": state, "questions": {
            "alive_6h": {"type": "noul", "instructions": "This coin is still actively traded 6 hours from now"},
            "organic": {"type": "noul", "instructions": "Most buyers in the last 30 minutes are separate real wallets"},
            "flush": {"type": "noul", "instructions": "Price just flushed down and buyers are absorbing it"},
            "chase": {"type": "noul", "instructions": "This entry is chasing a green candle that already ran"}}}
        r = await self.http.post("https://api.typesafe.ai/v1/systemone", json=body,
                                 headers={"Authorization": f"Bearer {key}"})
        r.raise_for_status()
        j = r.json()
        ans = {k: j["answers"][k]["noul"] for k in ("alive_6h", "organic", "flush", "chase")}
        if any(not isinstance(v, (int, float)) or not 0 <= v <= 1 for v in ans.values()):
            raise ValueError("bad answer")
        return ans, (j.get("usage") or {}).get("input_tokens", 0), j.get("model", "jev")

    async def evaluate(self, item):
        scan, audit, s = item["scan"], item["audit"], self.st
        mint = scan["mint"]
        p = (await self.src.dex_pairs([mint])).get(mint)
        if not p:
            return self._reject(scan, ["no data"], None, 0, "rules", 0, {})
        bundled = 0
        for l in (audit or {}).get("layers", []):
            if l["n"] == 7 and l["value"] not in (None, "None"):
                try:
                    bundled = int(l["value"].split()[0])
                except ValueError:
                    pass
        model, tokens = "rules", 0
        if s["analyst.mode"] == "jev":
            try:
                ans, tokens, model = await self.jev(build_state(scan, p, audit))
            except Exception as e:
                log.warning("jev failed %s", e)
                return self._reject(scan, ["no answer"], None, 0, "jev", 0, {})
        else:
            ans = rules_answers(p, bundled, s)
        score, failed = gate(ans, s)
        if failed:
            return self._reject(scan, failed, ans, score, model, tokens, p)
        self.db.x("INSERT INTO verdicts(mint,ts,alive_6h,organic,flush,chase,score,pass,reason,input_tokens)"
                  " VALUES(?,?,?,?,?,?,?,?,?,?)", (mint, time.time(), *ans.values(), score, 1, None, tokens))
        out = {"agent": "analyst", "mint": mint, "answers": ans, "score": score, "passed": True, "failed": [],
               "model": model, "inputTokens": tokens, "scan": scan, "pair": p}
        self.bus.emit("verdict", out)
        self.bus.executor.put_nowait(out)
        return out

    def _reject(self, scan, failed, ans, score, model, tokens, p):
        mint = scan["mint"]
        a = ans or {"alive_6h": 0, "organic": 0, "flush": 0, "chase": 1}
        self.db.x("INSERT INTO verdicts(mint,ts,alive_6h,organic,flush,chase,score,pass,reason,input_tokens)"
                  " VALUES(?,?,?,?,?,?,?,?,?,?)", (mint, time.time(), *a.values(), score, 0, failed[0], tokens))
        who = "Analyst (rules)" if model == "rules" else "Analyst"
        self.db.activity("rejected", mint, "analyst", f"Rejected {scan.get('name') or mint[:6]}",
                         f"{who} · {failed[0]}", "Skipped")
        out = {"agent": "analyst", "mint": mint, "answers": a, "score": score, "passed": False,
               "failed": failed, "model": model, "inputTokens": tokens}
        self.bus.emit("verdict", out)
        return out

    async def run(self):
        while True:
            item = await self.bus.analyst.get()
            self.db.beat("analyst")
            m = item["scan"]["mint"]
            if m in self.seen:
                continue
            self.seen.add(m)
            try:
                await self.evaluate(item)
            except Exception:
                log.exception("analyst")
