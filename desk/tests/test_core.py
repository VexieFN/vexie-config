import re
import time
import pytest

import links
from agents.analyst import gate, rules_answers
from agents.executor import size_ticket
from agents.risk import evaluate, effective_stop
from config import Settings, SettingsError
from db import DB
from fees import fee_usd


@pytest.fixture
def st():
    return Settings(DB())


def test_links():
    u = links.coin_url("MINT")
    assert "r=savipww" in u and "chainId=1399811149" in u
    assert links.coin_url("X", "monad") == links.SIGNUP_URL
    assert "r=savipww" in links.profile_url("@bob")


def test_no_hand_built_fomo_urls():
    import glob
    for f in glob.glob("**/*.py", recursive=True):
        if f.endswith("links.py") or "tests" in f:
            continue
        assert "fomo.family" not in open(f).read(), f


def test_gate_thresholds(st):
    ok = {"alive_6h": 0.70, "organic": 0.65, "flush": 1.0, "chase": 0.30}
    assert gate(ok, st)[1] == []
    for k, v in (("alive_6h", 0.69), ("organic", 0.64), ("chase", 0.31)):
        a = dict(ok, **{k: v})
        assert any(f.startswith(k) for f in gate(a, st)[1])
    low = {"alive_6h": 0.7, "organic": 0.65, "flush": 0.0, "chase": 0.3}
    assert gate(low, st)[0] == 51 and gate(low, st)[1] == ["score 51"]


def test_rules_mode(st):
    p = {"vol_h1": 25000, "buys_h1": 150, "ch_m5": -6, "buys_m5": 5, "sells_m5": 3, "ch_h1": 24}
    a = rules_answers(p, 0, st)
    assert a["alive_6h"] == 1 and a["organic"] == 1 and a["flush"] == 1 and a["chase"] == pytest.approx(0.3)
    assert rules_answers(p, 3, st)["organic"] == 0.5


def pos(**k):
    base = dict(entry_price=1.0, peak_price=1.0, stop_pct=6, trail_active=0, opened_at=1000)
    return {**base, **k}


def test_risk(st):
    now = 1000
    peak, trail, r = evaluate(pos(), 1.25, st, now)
    assert (peak, trail, r) == (1.25, True, None)
    _, _, r = evaluate(pos(peak_price=1.25, trail_active=1), 1.25 * 0.87, st, now)
    assert r == "trail"
    assert evaluate(pos(), 0.939, st, now)[2] == "stop"
    assert evaluate(pos(), 0.941, st, now)[2] is None
    assert evaluate(pos(opened_at=0), 1.04, st, 3 * 3600)[2] == "timeout"
    assert evaluate(pos(opened_at=0), 1.06, st, 3 * 3600)[2] is None


def test_stop_only_tightens():
    assert effective_stop(6, 8) == 6   # loosening never applies to open
    assert effective_stop(6, 4) == 4


def test_executor_sizing(st):
    assert size_ticket(200, 200, 1e6, st) == (47.5, None)          # bump
    st.set("executor.below_min", "skip")
    assert size_ticket(200, 200, 1e6, st) == (None, "under $47.5")
    st.set("executor.below_min", "bump")
    assert size_ticket(10000, 10000, 40000, st)[0] == 800.0        # pool cap 2%
    assert size_ticket(200, 20, 1e6, st) == (None, "no free stack")


def test_settings_range_and_min_stack(st):
    with pytest.raises(SettingsError):
        st.set("risk.stop_pct", 99)
    assert st.set("stop", 8) == (6, 8)
    assert round(st.min_stack(), 2) == 593.75


def test_fees():
    assert fee_usd(40) == pytest.approx(0.72)
    assert fee_usd(100) == pytest.approx(0.855)
    assert fee_usd(1000) == pytest.approx(4.5)


def test_token_account_slice_parse():
    from sources import parse_slice, b58
    owner, dele = bytes(range(1, 33)), bytes([7] * 32)
    d = owner + (1234).to_bytes(8, "little") + (1).to_bytes(4, "little") + dele
    o, dg, amt = parse_slice(d)
    assert o == b58(owner) and dg == b58(dele) and amt == 1234
    d2 = owner + (0).to_bytes(8, "little") + (0).to_bytes(4, "little") + bytes(32)
    assert parse_slice(d2) == (b58(owner), None, 0)
    assert b58(bytes(32)) == "1" * 32
    # known vector: the System Program id is 32 zero bytes, Token program id round-trip length
    assert len(b58(bytes([255] * 32))) == 44
