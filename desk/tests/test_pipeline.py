import asyncio
import time
import pytest

from agents.auditor import Auditor
from agents.executor import Executor
from agents.risk import Risk
from bus import Bus
from config import Settings
from db import DB
from notifier import Notifier

MINT, POOL, DEV = "MintMint1111", "PoolPool1111", "Dev11111111"


class Fake:
    def __init__(self, freeze=None, price=1.0, liq=100000):
        self.freeze, self.price, self.liq = freeze, price, liq

    async def mint_info(self, m):
        return {"mintAuthority": None, "freezeAuthority": self.freeze, "supply": "1000000000", "decimals": 3}

    async def owner_balance(self, o, m):
        return 100.0

    async def largest(self, m):
        return [{"address": f"a{i}", "uiAmount": 1000.0} for i in range(10)]

    async def rpc(self, method, params):
        return {"value": [{"data": {"parsed": {"info": {"owner": f"o{i}"}}}} for i in range(10)]}

    async def rugcheck(self, m):
        return {"markets": [{"pubkey": POOL, "lp": {"lpLockedPct": 100}}]}

    async def rug_graph(self, m):
        return {"nodes": [{"id": f"o{i}"} for i in range(10)], "links": []}

    async def token_accounts(self, m):
        return [(f"o{i}", None, 5.0) for i in range(20)]

    async def dex_pairs(self, mints):
        return {m: {"price": self.price, "liq": self.liq, "vol_m5": 1, "name": "Coin", "vol_h1": 30000,
                    "buys_h1": 200, "sells_h1": 50, "ch_m5": -6, "buys_m5": 5, "sells_m5": 2, "ch_h1": 10}
                for m in mints}


def setup(src):
    db = DB(); st = Settings(db); bus = Bus()
    db.x("INSERT INTO coins(mint,name,pool,migrated_at,creator,creator_balance_at_migration) VALUES(?,?,?,?,?,?)",
         (MINT, "Coin", POOL, time.time() - 3600, DEV, 100.0))
    return db, st, bus


SCAN = {"mint": MINT, "pool": POOL, "name": "Coin", "liquidityUsd": 100000}


@pytest.mark.asyncio
async def test_freeze_authority_red_at_layer_2():
    db, st, bus = setup(None)
    out = await Auditor(st, db, bus, Fake(freeze="Someone")).audit(SCAN)
    assert not out["passed"] and out["reason"] == "freeze not revoked"
    assert [l["value"] for l in out["layers"][2:]] == ["not checked"] * 6
    assert db.one("SELECT subtitle FROM activity")["subtitle"] == "Auditor · freeze not revoked"


@pytest.mark.asyncio
async def test_clean_coin_passes_all_8():
    db, st, bus = setup(None)
    out = await Auditor(st, db, bus, Fake()).audit(SCAN)
    assert out["passed"] and out["layersChecked"] == 8, out["layers"]
    assert bus.analyst.qsize() == 1


@pytest.mark.asyncio
async def test_signal_to_paper_exit_with_links():
    src = Fake()
    db, st, bus = setup(src)
    n = Notifier()
    ex, risk = Executor(st, db, bus, src, n), Risk(st, db, bus, src, n)
    a = {"mint": MINT, "scan": SCAN, "score": 80, "pair": {"price": 1.0}}
    await ex.handle(a)
    pos = db.one("SELECT * FROM positions")
    assert pos["size_usd"] == 47.5                                # $200 stack bumped
    assert n.sent[0]["text"].startswith("PAPER · Buy Coin")
    assert "r=savipww" in n.sent[0]["buttons"][0][1]
    st.set("risk.stop_pct", 8)                                    # loosening: open position keeps -6
    src.price = 0.93                                              # -7%
    await risk.poll()
    pos = db.one("SELECT * FROM positions")
    assert pos["status"] == "closed" and pos["exit_reason"] == "stop" and pos["pnl_usd"] < 0
    assert "-6% stop" in n.sent[-1]["text"]
    assert "r=savipww" in n.sent[-1]["buttons"][0][1]
