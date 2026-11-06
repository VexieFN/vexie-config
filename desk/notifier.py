"""Pushes. Telegram if token set, else console. Buttons always come from links.py URLs."""
import logging
import httpx

log = logging.getLogger("notifier")


class Notifier:
    def __init__(self, token=None, chat_id=None, client=None):
        self.token, self.chat_id = token, chat_id
        self.http = client or httpx.AsyncClient(timeout=15)
        self.sent = []  # for tests

    async def push(self, text, buttons=None, mode="PAPER"):
        """buttons: list of (label, url|None, callback|None)."""
        if mode == "PAPER":
            text = "PAPER · " + text
        self.sent.append({"text": text, "buttons": buttons or []})
        if not (self.token and self.chat_id):
            log.info("PUSH %s %s", text, buttons)
            if buttons:
                for label, url, _ in buttons:
                    if url:
                        log.info("  [%s] %s", label, url)
            return True
        kb = [[({"text": l, "url": u} if u else {"text": l, "callback_data": c})
               for l, u, c in (buttons or [])]]
        for _ in range(3):
            try:
                r = await self.http.post(f"https://api.telegram.org/bot{self.token}/sendMessage",
                                         json={"chat_id": self.chat_id, "text": text,
                                               "reply_markup": {"inline_keyboard": kb}})
                if r.status_code == 200:
                    return True
            except httpx.HTTPError:
                pass
        log.error("push failed")
        return False
