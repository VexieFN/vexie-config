"""Raw-key mapping. UNVERIFIED until logs/raw/ samples are captured (run `python -m desk.sample`).
Every accessor returns None if the key is absent. Never guesses."""


def _g(d, *path):
    for p in path:
        if isinstance(d, dict):
            d = d.get(p)
        elif isinstance(d, list) and isinstance(p, int) and -len(d) <= p < len(d):
            d = d[p]
        else:
            return None
    return d


def migration(msg):
    return {"mint": _g(msg, "mint"), "pool": _g(msg, "pool"), "signature": _g(msg, "signature"),
            "creator": _g(msg, "creator") or _g(msg, "traderPublicKey"),
            "name": _g(msg, "name"), "symbol": _g(msg, "symbol")}


def pair(p):
    """DexScreener pair -> flat dict."""
    p = p or {}
    return {
        "pair": _g(p, "pairAddress"), "dex": _g(p, "dexId"),
        "price": float(_g(p, "priceUsd")) if _g(p, "priceUsd") else None,
        "liq": _g(p, "liquidity", "usd"), "mcap": _g(p, "marketCap"),
        "vol_m5": _g(p, "volume", "m5"), "vol_h1": _g(p, "volume", "h1"), "vol_h24": _g(p, "volume", "h24"),
        "buys_m5": _g(p, "txns", "m5", "buys"), "sells_m5": _g(p, "txns", "m5", "sells"),
        "buys_h1": _g(p, "txns", "h1", "buys"), "sells_h1": _g(p, "txns", "h1", "sells"),
        "ch_m5": _g(p, "priceChange", "m5"), "ch_h1": _g(p, "priceChange", "h1"),
        "ch_h24": _g(p, "priceChange", "h24"),
        "created_ms": _g(p, "pairCreatedAt"),
        "name": _g(p, "baseToken", "name"), "symbol": _g(p, "baseToken", "symbol"),
    }


def best_pumpswap_pair(pairs, mint):
    c = [p for p in pairs if _g(p, "baseToken", "address") == mint and _g(p, "dexId") == "pumpswap"]
    c.sort(key=lambda p: _g(p, "liquidity", "usd") or 0, reverse=True)
    return c[0] if c else None


def rug_creator(report):
    return _g(report, "creator")


def rug_lp_locked_pct(report, pool):
    for m in _g(report, "markets") or []:
        if _g(m, "pubkey") == pool or _g(m, "address") == pool:
            v = _g(m, "lp", "lpLockedPct")
            return float(v) if v is not None else None
    return None


def graph_edges(graph):
    """-> (set of wallets, list of (a,b)) or (None, None) if no edge key."""
    if not isinstance(graph, dict):
        return None, None
    nodes = graph.get("nodes")
    edges = graph.get("links", graph.get("edges"))
    if edges is None or nodes is None:
        return None, None
    ids = {n.get("id") if isinstance(n, dict) else n for n in nodes}
    pairs = [(e.get("source"), e.get("target")) for e in edges if isinstance(e, dict)]
    return ids, pairs
