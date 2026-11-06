import sqlite3
import threading
import time

SCHEMA = """
CREATE TABLE IF NOT EXISTS coins(mint TEXT PRIMARY KEY, name TEXT, symbol TEXT, pool TEXT, migrated_at REAL,
  creator TEXT, creator_balance_at_migration REAL, holders INTEGER);
CREATE TABLE IF NOT EXISTS scans(id INTEGER PRIMARY KEY, mint TEXT, ts REAL, liquidity_usd REAL, top10_pct REAL,
  h1_change_pct REAL, age_min REAL, verdict TEXT, reason TEXT);
CREATE TABLE IF NOT EXISTS audits(id INTEGER PRIMARY KEY, mint TEXT, ts REAL, layer INTEGER, name TEXT,
  value_text TEXT, pass INTEGER, source TEXT);
CREATE TABLE IF NOT EXISTS verdicts(id INTEGER PRIMARY KEY, mint TEXT, ts REAL, alive_6h REAL, organic REAL,
  flush REAL, chase REAL, score INTEGER, pass INTEGER, reason TEXT, input_tokens INTEGER);
CREATE TABLE IF NOT EXISTS signals(id INTEGER PRIMARY KEY, mint TEXT, ts REAL, price REAL, size_usd REAL,
  stack_pct REAL, link TEXT, mode TEXT, status TEXT);
CREATE TABLE IF NOT EXISTS positions(id INTEGER PRIMARY KEY, mint TEXT, name TEXT, opened_at REAL, entry_price REAL,
  size_usd REAL, peak_price REAL, stop_pct REAL, trail_active INTEGER DEFAULT 0, closed_at REAL, exit_price REAL,
  exit_reason TEXT, pnl_usd REAL, fees_usd REAL, mode TEXT, status TEXT DEFAULT 'open', night INTEGER);
CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY, ts REAL, kind TEXT, mint TEXT, agent TEXT, title TEXT,
  subtitle TEXT, value TEXT);
CREATE TABLE IF NOT EXISTS prices(mint TEXT, ts REAL, price REAL, volume_m5 REAL, liquidity REAL);
CREATE INDEX IF NOT EXISTS ix_prices ON prices(mint, ts);
CREATE TABLE IF NOT EXISTS balance(ts REAL, value REAL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT, updated_at REAL);
CREATE TABLE IF NOT EXISTS change_log(ts REAL, key TEXT, old TEXT, new TEXT, who TEXT);
CREATE TABLE IF NOT EXISTS skips(mint TEXT PRIMARY KEY, until REAL);
CREATE TABLE IF NOT EXISTS heartbeats(agent TEXT PRIMARY KEY, ts REAL);
CREATE TABLE IF NOT EXISTS push_subs(endpoint TEXT PRIMARY KEY, p256dh TEXT, auth TEXT, created_at REAL);
CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT);
"""


class DB:
    def __init__(self, path=":memory:"):
        self.c = sqlite3.connect(path, check_same_thread=False)
        self.c.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        with self.lock:
            self.c.execute("PRAGMA journal_mode=WAL")
            self.c.executescript(SCHEMA)

    def q(self, sql, args=()):
        with self.lock:
            return self.c.execute(sql, args).fetchall()

    def one(self, sql, args=()):
        r = self.q(sql, args)
        return r[0] if r else None

    def x(self, sql, args=()):
        with self.lock:
            cur = self.c.execute(sql, args)
            self.c.commit()
            return cur.lastrowid

    # settings
    def all_settings(self):
        return {r["key"]: r["value"] for r in self.q("SELECT key,value FROM settings")}

    def save_setting(self, k, v, ts):
        self.x("INSERT OR REPLACE INTO settings VALUES(?,?,?)", (k, v, ts))

    def log_change(self, ts, k, o, n, who):
        self.x("INSERT INTO change_log VALUES(?,?,?,?,?)", (ts, k, o, n, who))

    # kv / heartbeat / activity / prices
    def kv_get(self, k, default=None):
        r = self.one("SELECT value FROM kv WHERE key=?", (k,))
        return r["value"] if r else default

    def kv_set(self, k, v):
        self.x("INSERT OR REPLACE INTO kv VALUES(?,?)", (k, str(v)))

    def beat(self, agent):
        self.x("INSERT OR REPLACE INTO heartbeats VALUES(?,?)", (agent, time.time()))

    def activity(self, kind, mint, agent, title, subtitle, value, ts=None):
        self.x("INSERT INTO activity(ts,kind,mint,agent,title,subtitle,value) VALUES(?,?,?,?,?,?,?)",
               (ts or time.time(), kind, mint, agent, title, subtitle, value))

    def price(self, mint, price, vol_m5=None, liq=None, ts=None):
        self.x("INSERT INTO prices VALUES(?,?,?,?,?)", (mint, ts or time.time(), price, vol_m5, liq))

    def last_price(self, mint):
        r = self.one("SELECT price FROM prices WHERE mint=? ORDER BY ts DESC LIMIT 1", (mint,))
        return r["price"] if r else None
