import pytest
from fastapi.testclient import TestClient

from api import make_app
from config import Settings
from control import Control
from db import DB
from notifier import Notifier
from telegram import Telegram


def mk():
    db = DB(); st = Settings(db); ctl = Control(db)
    return db, st, ctl, TestClient(make_app(db, st, ctl, "secret"))


H = {"Authorization": "Bearer secret"}


def test_boots_off_and_needs_token():
    db, st, ctl, c = mk()
    assert ctl.active is False
    assert c.get("/api/state").status_code == 401
    assert c.get("/api/state", headers={"Authorization": "Bearer nope"}).status_code == 401
    assert c.get("/api/state", headers=H).json()["running"] is False


def test_start_stop_from_app():
    db, st, ctl, c = mk()
    assert c.post("/api/start", headers=H).json()["running"] and ctl.active
    assert not c.post("/api/stop", headers=H).json()["running"] and not ctl.active


def test_settings_validation_and_live_lock():
    db, st, ctl, c = mk()
    assert c.post("/api/settings", headers=H, json={"key": "risk.stop_pct", "value": 99}).status_code == 400
    assert c.post("/api/mode", headers=H, json={"mode": "LIVE", "confirm": "LIVE"}).status_code == 400  # no paper trade yet


def test_telegram_commands():
    db, st, ctl, _ = mk()
    t = Telegram("x", db, st, ctl, Notifier(), None)
    assert "Acceso" in t.handle_text("/on") and ctl.active
    assert "Spento" in t.handle_text("/off") and not ctl.active
    assert "6 -> 8" in t.handle_text("set stop to -8%")
    assert "bloccato" in t.handle_text("LIVE")
