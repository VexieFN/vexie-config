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


def test_live_insiders_graph_sample_2026_11_07():
    """Truncated real network from RugCheck (mint 87CQ...1UJT)."""
    F = "Fgej4SPuW282TdrQRfizRHAeRasNqCtAWZizL3jDqMdS"
    holdings = {"5rmK5QPcPDtXMhgNJz6LABkTNtJnzcWp26bzFq3zJFo6": 145373047520, F: 136078192592,
                "2CYbdaTFe8tDydS26BUPLURdcfG48grBn8tH2imjpGzC": 3075055265192,
                "EnajNmJ3mBGHJ6VZ4CDQfzVnRqWbtaqnt3o9THaeUQkV": 136078192592,
                "71Tp19Kx6YYfFP3ifrBkduYKSYazzXgaG8pgsnbkHXZS": 12065235549,
                "CKCpQE61cbDkcHvvvAaZ1qbDwp39PRZzNpzVzze3m2kq": 0,
                "DJtWZyKQESWhMeGtuX7jZgFi7MSLGkfc4oq4A6QuoL5B": 29067183147,
                "29tKd4h4FsF2czYicypWcrSoigRBn61NH1tZecWM3Jhj": 43776462464}
    net = {"net_id": "f259e065", "network_type": "transfer",
           "nodes": [{"id": k, "participant": True, "holdings": v} for k, v in holdings.items()],
           "links": [{"source": F, "target": t} for t in ("CKCpQE61cbDkcHvvvAaZ1qbDwp39PRZzNpzVzze3m2kq",
                     "71Tp19Kx6YYfFP3ifrBkduYKSYazzXgaG8pgsnbkHXZS", "2CYbdaTFe8tDydS26BUPLURdcfG48grBn8tH2imjpGzC",
                     "EnajNmJ3mBGHJ6VZ4CDQfzVnRqWbtaqnt3o9THaeUQkV", "5rmK5QPcPDtXMhgNJz6LABkTNtJnzcWp26bzFq3zJFo6")]}
    assert fields.bundled_size([net]) == 6
    current_holders = {k for k, v in holdings.items() if v > 0}       # CKCp sold out
    assert fields.bundled_size([net], current_holders) == 5            # still >= 5 -> layer 7 red


def test_live_pumpportal_migration_message():
    msg = {"mint": "EjqNrysyT1HaP2nmB76cKTY6zkLFSh7sr5qXNhAVpump", "pool": "pump-amm",
           "signature": "Lzr8hq", "txType": "migrate"}
    m = fields.migration(msg)
    assert m["mint"].endswith("pump") and m["pool"] is None and m["creator"] is None
