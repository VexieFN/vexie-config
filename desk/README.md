# Desk — 5-agent memecoin screener (PAPER first)

Scanner → Auditor (8 layers) → Analyst (rules or Jev) → Executor (sizing + Buy button) → Risk (stop/trail/timeout).
Never places orders: you tap Buy/Sell on FOMO. All FOMO URLs come from `links.py` (always `r=savipww`).

```bash
pip install -r requirements.txt
python -m pytest -q          # 12 tests
TG_TOKEN=... TG_CHAT_ID=... python main.py      # without them pushes go to the log
```
Optional env: `TYPESAFE_API_KEY` (Jev mode), `DESK_DB` (sqlite path).

## Status
Done: core agents, settings with ranges, fee model, links, notifier (Telegram/console), tests.
Todo: Telegram commands, iPhone web app + API, morning report, data recorder + backtest,
`fields.py` is UNVERIFIED until real API samples are captured.
