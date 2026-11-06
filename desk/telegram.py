"""Long-polling Telegram commands. Owner only: first /start sender becomes owner (or TG_CHAT_ID if set)."""
import asyncio
import logging
import re

import links
from agents.executor import balance
from config import SettingsError

log = logging.getLogger("telegram")
HELP = ("/on  avvia la ricerca\n/off  ferma (le posizioni aperte restano sorvegliate)\n/status\n"
        "stop -8   cambia lo stop\nstack 8   % di stack per trade\npaper | live (scrivi LIVE)\n/invite")


class Telegram:
    def __init__(self, token, db, st, ctl, notifier, executor):
        self.token, self.db, self.st, self.ctl, self.n, self.ex = token, db, st, ctl, notifier, executor
        self.offset = 0

    def owner(self):
        return self.n.chat_id or self.db.kv_get("owner_chat_id")

    async def call(self, method, **kw):
        r = await self.n.http.post(f"https://api.telegram.org/bot{self.token}/{method}", json=kw, timeout=40)
        return r.json().get("result")

    def status(self):
        b = balance(self.db, self.st)
        opens = self.db.q("SELECT name FROM positions WHERE status IN ('open','exiting')")
        return (f"{'ON' if self.ctl.active else 'OFF'} · {self.st['desk.mode']} · balance ${b:.2f}\n"
                f"Posizioni aperte: {', '.join(r['name'] for r in opens) or 'nessuna'}")

    def handle_text(self, t):
        t = t.strip()
        low = t.lower()
        if low in ("/on", "on", "/avvia", "avvia"):
            self.ctl.start(); return "Acceso. Cerco monete."
        if low in ("/off", "off", "/ferma", "ferma"):
            self.ctl.stop(); return "Spento. Nessun nuovo segnale. " + self.status().split("\n")[1]
        if low in ("/status", "status"):
            return self.status()
        if low in ("/invite", "invite"):
            return links.SIGNUP_URL
        if low == "paper":
            self.st.set("desk.mode", "PAPER", "telegram"); return "Modalità PAPER"
        if t == "LIVE":
            n = self.db.one("SELECT COUNT(*) n FROM positions WHERE mode='PAPER' AND status='closed'")["n"]
            if n < 1:
                return "LIVE bloccato: serve almeno 1 trade PAPER chiuso."
            self.st.set("desk.mode", "LIVE", "telegram"); return "Modalità LIVE. Ricorda: compri tu su FOMO."
        if low == "live":
            return "Per passare a LIVE scrivi: LIVE (maiuscolo) dopo almeno 1 trade PAPER chiuso"
        m = re.match(r"(?:set )?(stop|trail|stack)(?: to)?\s+(-?\d+(?:\.\d+)?)%?$", low)
        if m:
            key = {"stop": "risk.stop_pct", "trail": "risk.trail_pct", "stack": "executor.stack_pct"}[m.group(1)]
            try:
                old, new = self.st.set(key, abs(float(m.group(2))), "telegram")
            except SettingsError as e:
                return str(e)
            return f"{m.group(1)} {old} -> {new}" + (" (le posizioni aperte si stringono ma non si allargano)" if key == "risk.stop_pct" else "")
        return HELP

    async def run(self):
        while True:
            try:
                for u in await self.call("getUpdates", offset=self.offset, timeout=30) or []:
                    self.offset = u["update_id"] + 1
                    msg = u.get("message") or {}
                    cb = u.get("callback_query")
                    chat = str((msg.get("chat") or (cb or {}).get("message", {}).get("chat") or {}).get("id", ""))
                    if not self.owner() and msg.get("text", "").startswith("/start"):
                        self.db.kv_set("owner_chat_id", chat); self.n.chat_id = chat
                        await self.call("sendMessage", chat_id=chat, text="Owner impostato.\n" + HELP)
                        continue
                    if chat != str(self.owner()):
                        continue                      # ignore everyone else, no reply
                    if cb:
                        kind, _, arg = cb["data"].partition(":")
                        if kind == "bought": self.ex.on_bought(arg)
                        elif kind == "skip": self.ex.on_skip(arg)
                        elif kind == "sold": self.db.x("UPDATE positions SET status='closed' WHERE id=? AND status='exiting'", (int(arg),))
                        await self.call("answerCallbackQuery", callback_query_id=cb["id"])
                    elif msg.get("text"):
                        await self.call("sendMessage", chat_id=chat, text=self.handle_text(msg["text"]))
            except Exception:
                log.exception("telegram poll")
                await asyncio.sleep(5)
