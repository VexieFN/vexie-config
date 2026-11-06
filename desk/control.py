"""Manual on/off. Default OFF at every boot: the desk never starts hunting by itself.
OFF = Scanner stops intake (websocket closed). Risk keeps guarding open positions."""
import time


class Control:
    def __init__(self, db):
        self.db = db
        self.active = False          # never persisted as True: always boots OFF
        self.since = None

    def start(self):
        self.active, self.since = True, time.time()
        self.db.kv_set("last_start", self.since)

    def stop(self):
        self.active, self.since = False, None
        self.db.kv_set("last_stop", time.time())
