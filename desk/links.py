"""THE ONLY place FOMO URLs are built."""
CHAIN_ID = {"solana": 1399811149, "robinhood": 4663, "base": 8453, "bnb": 56}
SIGNUP_URL = "https://fomo.family/r/savipww"


def coin_url(address: str, chain: str = "solana") -> str:
    if chain not in CHAIN_ID:
        return SIGNUP_URL
    return (f"https://fomo.family/coin?address={address}&chainId={CHAIN_ID[chain]}"
            f"&r=savipww&source=share_link")


def profile_url(handle: str) -> str:
    return f"https://fomo.family/profile/{handle.lstrip('@')}?source=share_link&r=savipww"
