"""All external I/O. Agents depend on this interface so tests can inject a fake."""
import asyncio
import base64
import httpx
import fields

DEX = "https://api.dexscreener.com/tokens/v1/solana/"
RUG = "https://api.rugcheck.xyz/v1/tokens/"
TOKEN_PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]


class Sources:
    def __init__(self, rpc_url, client=None):
        self.rpc_url = rpc_url
        self.http = client or httpx.AsyncClient(timeout=15)

    async def dex_pairs(self, mints):
        out = {}
        for i in range(0, len(mints), 30):
            chunk = mints[i:i + 30]
            r = await self.http.get(DEX + ",".join(chunk))
            if r.status_code == 429:
                raise RateLimited()
            r.raise_for_status()
            data = r.json()
            for m in chunk:
                p = fields.best_pumpswap_pair(data, m)
                if p:
                    out[m] = fields.pair(p)
        return out

    async def rpc(self, method, params):
        for wait in (1, 2, 4, 0):  # public RPC rate-limits hard: back off on 429
            r = await self.http.post(self.rpc_url, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
            if r.status_code != 429 or not wait:
                break
            await asyncio.sleep(wait)
        r.raise_for_status()
        j = r.json()
        if "error" in j:
            raise RuntimeError(f"rpc {method}: {j['error']}")
        return j["result"]

    async def rugcheck(self, mint):
        r = await self.http.get(f"{RUG}{mint}/report")
        r.raise_for_status()
        return r.json()

    async def rug_graph(self, mint):
        r = await self.http.get(f"{RUG}{mint}/insiders/graph")
        r.raise_for_status()
        return r.json()

    async def mint_info(self, mint):
        res = await self.rpc("getAccountInfo", [mint, {"encoding": "jsonParsed"}])
        return res["value"]["data"]["parsed"]["info"]  # mintAuthority, freezeAuthority, supply, decimals

    async def largest(self, mint):
        return (await self.rpc("getTokenLargestAccounts", [mint]))["value"]

    async def owner_balance(self, owner, mint):
        res = await self.rpc("getTokenAccountsByOwner", [owner, {"mint": mint}, {"encoding": "jsonParsed"}])
        tot = 0.0
        for a in res["value"]:
            tot += float(a["account"]["data"]["parsed"]["info"]["tokenAmount"]["uiAmount"] or 0)
        return tot

    async def token_accounts(self, mint):
        """getProgramAccounts on Token and Token-2022 filtered by mint -> list of (owner, delegate, raw_amount).
        Uses base64 + dataSlice (owner, amount, delegate = 76 bytes/account) instead of jsonParsed:
        a popular mint can have tens of thousands of accounts and jsonParsed exhausts memory."""
        out = []
        for prog in TOKEN_PROGRAMS:
            res = await self.rpc("getProgramAccounts", [prog, {
                "encoding": "base64", "dataSlice": {"offset": 32, "length": 76},
                "filters": [{"memcmp": {"offset": 0, "bytes": mint}}]}])
            for a in res:
                out.append(parse_slice(base64.b64decode(a["account"]["data"][0])))
        return out


B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58(b: bytes) -> str:
    n = int.from_bytes(b, "big")
    s = ""
    while n:
        n, r = divmod(n, 58)
        s = B58[r] + s
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + s


def parse_slice(d: bytes):
    """76-byte slice from offset 32 of an SPL token account: owner(32) amount(u64) delegate COption(4+32)."""
    owner = b58(d[0:32])
    amount = int.from_bytes(d[32:40], "little")
    delegate = b58(d[44:76]) if int.from_bytes(d[40:44], "little") == 1 else None
    return owner, delegate, amount


class RateLimited(Exception):
    pass


def top10_pct(accounts, supply_raw, exclude_owners=()):
    """accounts: [(owner, delegate, raw_amount)] from token_accounts(). Sum per owner, drop pool/curve owners."""
    if not supply_raw:
        return None
    per = {}
    for owner, _, amt in accounts:
        if owner in exclude_owners or not amt:
            continue
        per[owner] = per.get(owner, 0) + amt
    return 100 * sum(sorted(per.values(), reverse=True)[:10]) / supply_raw
