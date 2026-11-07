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


def is_address(v):
    return isinstance(v, str) and 32 <= len(v) <= 44 and v.isalnum()


def migration(msg):
    # PumpPortal's "pool" may be a DEX label (e.g. "pump-amm"), not an address: keep it only if it is one.
    # The real pool address comes from DexScreener's pairAddress (Scanner sets it).
    pool = _g(msg, "pool")
    return {"mint": _g(msg, "mint"), "pool": pool if is_address(pool) else None, "signature": _g(msg, "signature"),
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
    if not pool:
        return None
    for m in _g(report, "markets") or []:
        if _g(m, "pubkey") == pool or _g(m, "address") == pool:
            v = _g(m, "lp", "lpLockedPct")
            return float(v) if v is not None else None
    return None


def _components(nodes, edges, holders):
    from collections import defaultdict
    keep = (lambda n: n in holders) if holders else (lambda n: True)
    adj = defaultdict(set)
    for a, b in edges:
        if keep(a) and keep(b):
            adj[a].add(b); adj[b].add(a)
    seen, best = set(), 0
    for n in nodes:
        if n in seen or not keep(n):
            continue
        stack, size = [n], 0
        seen.add(n)
        while stack:
            x = stack.pop(); size += 1
            for y in adj[x]:
                if y not in seen:
                    seen.add(y); stack.append(y)
        best = max(best, size)
    return best


def _node_id(n):
    return n.get("id") or n.get("address") or n.get("pubkey") if isinstance(n, dict) else n


def _edge(e):
    if isinstance(e, dict):
        return _node_id(e.get("source")), _node_id(e.get("target"))
    if isinstance(e, (list, tuple)) and len(e) == 2:
        return e[0], e[1]
    return None, None


def bundled_size(graph, holders=None):
    """Size of the biggest funded-together group of holders. RugCheck's insiders/graph is a LIST of networks
    ([] = none found). Each network: nodes+links (connected components) or a size field.
    -> int, or None when the shape is not recognised (Auditor treats None as red, never as a pass)."""
    if isinstance(graph, dict):
        graph = [graph]
    if not isinstance(graph, list):
        return None
    best = 0
    for net in graph:
        if not isinstance(net, dict):
            return None
        nodes, links = net.get("nodes"), net.get("links", net.get("edges"))
        if isinstance(nodes, list) and isinstance(links, list):
            ids = [_node_id(n) for n in nodes]
            best = max(best, _components(ids, [_edge(e) for e in links], holders))
        elif isinstance(net.get("size"), int):
            best = max(best, net["size"])
        else:
            return None
    return best
