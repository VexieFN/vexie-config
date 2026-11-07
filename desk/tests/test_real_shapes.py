"""Shapes observed live on 2026-11-07 via the app's Diagnostica (see selftest.py)."""
import time

import fields
from agents.auditor import Auditor
from bus import Bus
from config import Settings
from db import DB
from sources import top10_pct
from tests.test_pipeline import Fake, MINT, POOL, DEV


def test_graph_empty_list_means_no_bundles():
    assert fields.bundled_size([]) == 0


def test_graph_networks_list():
    nets = [{"nodes": [{"id": "a"}, {"id": "b"}, {"id": "c"}], "links": [{"source": "a", "target": "b"},
                                                                         {"source": "b", "target": "c"}]},
            {"nodes": [{"id": "x"}, {"id": "y"}], "links": [{"source": "x", "target": "y"}]}]
    assert fields.bundled_size(nets) == 3
    assert fields.bundled_size(nets, holders={"a", "b", "x", "y"}) == 2   # c sold out: not counted
    assert fields.bundled_size([{"size": 7}]) == 7
    assert fields.bundled_size([{"weird": 1}]) is None                     # unknown shape -> red, never pass
    assert fields.bundled_size("oops") is None


def test_pumpportal_pool_label_is_not_an_address():
    m = fields.migration({"signature": "s", "mint": MINT + "pump", "txType": "migrate", "pool": "pump-amm"})
    assert m["pool"] is None
    real = "GWpxi3LT6WznhS2zgJdBDymyYxBHt7Vk38fpeiRZVFcS"
    assert fields.migration({"mint": "m", "pool": real})["pool"] == real


def test_rugcheck_lp_mapping_real_shape():
    rep = {"markets": [{"pubkey": "other", "lp": {"lpLockedPct": 0}},
                       {"pubkey": POOL, "marketType": "pump_amm", "lp": {"lpLockedPct": 100}}]}
    assert fields.rug_lp_locked_pct(rep, POOL) == 100
    assert fields.rug_lp_locked_pct(rep, None) is None


def test_top10_groups_by_owner_and_drops_pool():
    accts = [(POOL, None, 500), ("w1", None, 100), ("w1", None, 50), ("w2", None, 10)]
    assert top10_pct(accts, 1000, {POOL}) == 16.0


class RealShapes(Fake):
    async def rug_graph(self, m):
        return []


async def test_auditor_passes_with_real_graph_shape():
    db = DB(); st = Settings(db); bus = Bus()
    db.x("INSERT INTO coins(mint,name,pool,migrated_at,creator,creator_balance_at_migration) VALUES(?,?,?,?,?,?)",
         (MINT, "Coin", POOL, time.time() - 3600, DEV, 100.0))
    out = await Auditor(st, db, bus, RealShapes()).audit({"mint": MINT, "pool": POOL, "name": "Coin",
                                                          "liquidityUsd": 100000})
    assert out["passed"], out["layers"]
    assert out["layers"][6]["value"] == "None"
