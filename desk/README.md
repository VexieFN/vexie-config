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

## Uso su iPhone (manuale, mai automatico)
Il desk parte sempre SPENTO. Lo accendi/spegni da:
- app web: apri `https://TUO-HOST/#t=APP_TOKEN` in Safari → Condividi → Aggiungi a Home. Bottone AVVIA/FERMA.
- Telegram: `/on`, `/off`, `/status`, `stop -8`, `stack 8`, `paper`, `LIVE`.
Fermando, nessun nuovo segnale; le posizioni aperte restano sorvegliate da Risk (stop/trail/timeout).
Env: `APP_TOKEN` (lungo e casuale), `TG_TOKEN`, `PORT`. Il processo deve restare acceso su un host (anche solo il processo: il *cercare* è manuale).

## Deploy su Fly.io
```bash
cd desk
fly launch --no-deploy --copy-config      # scegli un nome app unico
fly volumes create desk_data --size 1 --region fra
fly secrets set APP_TOKEN=$(openssl rand -hex 32) TG_TOKEN=xxx
fly deploy
```
App: `https://<nome>.fly.dev/#t=<APP_TOKEN>` in Safari → Condividi → Aggiungi alla schermata Home.
Il token: `fly ssh console -C "printenv APP_TOKEN"`.
