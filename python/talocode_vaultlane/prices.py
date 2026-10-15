import json
from importlib.resources import files

from .engine import VERSION

def credit_prices():
    catalog = json.loads(files("talocode_vaultlane").joinpath("credit-prices.json").read_text(encoding="utf-8"))
    live = None
    live_error = None
    try:
        import urllib.request
        request = urllib.request.Request(catalog["sources"]["live"], headers={"user-agent": f"talocode-vaultlane/{VERSION}"})
        with urllib.request.urlopen(request, timeout=15) as response:
            live = json.loads(response.read().decode())
    except Exception as error:
        live_error = str(error)
    live_products = list((live or {}).get("data", {}).get("pricing", {}))
    return {
        "ok": True,
        "product": "talocode-vaultlane",
        "version": VERSION,
        "catalog": catalog,
        "live": live,
        "liveError": live_error,
        "vaultlaneOnLiveEndpoint": "vaultlane" in live_products,
        "disclaimer": "Prices are copied from Talocode's public page and the live pricing endpoint. 1 credit = $0.01. Credits are product usage, not cash. Local VaultLane calls cost 0.",
    }
