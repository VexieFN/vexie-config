"""FOMO fee model on Solana (PAPER PnL). Per side, minus referral discount."""


def fee_usd(ticket: float, discount: float = 0.10) -> float:
    if ticket < 5:
        base = 0.0
    elif ticket < 47.5:
        base = ticket * 0.02
    elif ticket <= 190:
        base = 0.95
    else:
        base = ticket * 0.005
    return round(base * (1 - discount), 4)
