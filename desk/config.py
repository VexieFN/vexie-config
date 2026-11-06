"""Settings with defaults, ranges, validation, change log."""
import json
import time

# key: (default, min, max)  -- bool/str keys use (default, None, None)
DEFAULTS = {
    "scanner.min_liquidity_usd": (40000, 1000, 5_000_000),
    "scanner.max_top10_pct": (25, 1, 100),
    "scanner.max_h1_change_pct": (80, 5, 10000),
    "scanner.poll_s": (60, 10, 600),
    "scanner.min_pool_age_min": (10, 0, 240),
    "scanner.max_wait_min": (60, 5, 600),
    "scanner.runner_h24_pct": (300, 50, 100000),
    "auditor.enabled": (True, None, None),
    "auditor.max_dev_pct": (5, 0, 100),
    "auditor.max_top10_pct": (25, 1, 100),
    "auditor.min_lp_locked_pct": (99, 0, 100),
    "auditor.min_pool_age_min": (10, 0, 240),
    "auditor.max_bundled": (5, 1, 100),
    "auditor.max_delegated_accounts": (10, 1, 10000),
    "auditor.retries": (3, 0, 10),
    "analyst.mode": ("rules", None, None),
    "analyst.min_alive_6h": (0.70, 0, 1),
    "analyst.min_organic": (0.65, 0, 1),
    "analyst.max_chase": (0.30, 0, 1),
    "analyst.min_score": (70, 0, 100),
    "analyst.timeout_s": (10, 2, 60),
    "analyst.alive_volume_h1": (25000, 100, 10_000_000),
    "analyst.organic_buys_h1": (150, 5, 100000),
    "analyst.bundled_penalty": (0.5, 0, 1),
    "analyst.flush_drop_m5_pct": (5, 0.5, 100),
    "analyst.chase_h1_pct": (80, 5, 10000),
    "executor.stack_pct": (8, 0.5, 50),
    "executor.max_pool_pct": (2, 0.1, 20),
    "executor.min_ticket_usd": (47.5, 5, 10000),
    "executor.below_min": ("bump", None, None),
    "executor.recheck_liq_drop_pct": (20, 1, 100),
    "executor.recheck_price_up_pct": (15, 1, 500),
    "executor.confirm_window_min": (5, 1, 60),
    "risk.poll_s": (15, 5, 120),
    "risk.stop_pct": (6, 1, 50),
    "risk.trail_start_pct": (20, 1, 1000),
    "risk.trail_pct": (12, 1, 90),
    "risk.timeout_h": (3, 0.1, 48),
    "risk.timeout_min_gain_pct": (5, 0, 100),
    "risk.confirm_window_min": (2, 1, 60),
    "desk.mode": ("PAPER", None, None),
    "desk.paper_start_stack": (200, 10, 10_000_000),
    "desk.live_stack": (0, 0, 10_000_000),
    "desk.report_time": ("08:00", None, None),
    "desk.rpc_url": ("https://api.mainnet-beta.solana.com", None, None),
    "desk.push_rejects": (False, None, None),
    "desk.fees_ref_discount": (0.10, 0, 0.5),
    "desk.fomo_handle": ("", None, None),
}
ALIASES = {"stop": "risk.stop_pct", "trail": "risk.trail_pct", "stack_pct": "executor.stack_pct",
           "stack": "desk.live_stack", "mode": "desk.mode"}


class SettingsError(ValueError):
    pass


class Settings:
    def __init__(self, db):
        self.db = db
        self._v = {k: d[0] for k, d in DEFAULTS.items()}
        for k, v in db.all_settings().items():
            if k in DEFAULTS:
                self._v[k] = json.loads(v)

    def get(self, key):
        return self._v[ALIASES.get(key, key)]

    __getitem__ = get

    def set(self, key, value, who="user"):
        key = ALIASES.get(key, key)
        if key not in DEFAULTS:
            raise SettingsError(f"unknown setting {key}")
        default, lo, hi = DEFAULTS[key]
        if isinstance(default, bool):
            value = bool(value)
        elif isinstance(default, str):
            value = str(value)
            if key == "desk.mode" and value not in ("PAPER", "LIVE"):
                raise SettingsError("mode must be PAPER or LIVE")
            if key == "executor.below_min" and value not in ("bump", "skip"):
                raise SettingsError("below_min must be bump or skip")
            if key == "analyst.mode" and value not in ("rules", "jev"):
                raise SettingsError("analyst.mode must be rules or jev")
        else:
            value = type(default)(value)
            if not (lo <= value <= hi):
                raise SettingsError(f"{key} must be between {lo} and {hi}")
        old = self._v[key]
        self._v[key] = value
        self.db.save_setting(key, json.dumps(value), time.time())
        self.db.log_change(time.time(), key, json.dumps(old), json.dumps(value), who)
        return old, value

    def min_stack(self):
        return self["executor.min_ticket_usd"] / (self["executor.stack_pct"] / 100)
