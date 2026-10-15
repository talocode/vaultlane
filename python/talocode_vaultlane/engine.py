import re
from datetime import datetime, timezone

VERSION = "0.1.0"
WEIGHT_TOTAL = 10_000
LIMITS = {"maxAssets": 100, "maxOracles": 4, "maxManagers": 10}
MINT = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")


def _num(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:
        return None
    return number


def _fail(errors):
    return {"ok": False, "version": VERSION, "errors": errors, "executes": False}


def plan_vault(data=None):
    data = data or {}
    errors = []
    assets = data.get("assets") if isinstance(data.get("assets"), list) else None
    if not isinstance(data.get("name"), str) or not data.get("name"):
        errors.append("name is required")
    if not assets:
        errors.append("at least one asset is required")
    if assets and len(assets) > LIMITS["maxAssets"]:
        errors.append(f"a vault holds at most {LIMITS['maxAssets']} assets")
    managers = data.get("managers") if isinstance(data.get("managers"), list) else []
    if len(managers) > LIMITS["maxManagers"]:
        errors.append(f"a vault has at most {LIMITS['maxManagers']} managers")

    normalized = []
    seen = set()
    for asset in assets or []:
        mint = str(asset.get("mint") or "")
        target = _num(asset.get("targetBps"))
        if not MINT.match(mint):
            errors.append(f"bad mint: {mint or '(empty)'}")
        if mint in seen:
            errors.append(f"duplicate mint: {mint}")
        seen.add(mint)
        if target is None or int(target) != target or target < 0:
            errors.append(f"{mint or asset.get('symbol') or 'asset'} targetBps must be a non-negative integer")
        oracles = asset.get("oracles") if isinstance(asset.get("oracles"), list) else []
        if not oracles or len(oracles) > LIMITS["maxOracles"]:
            errors.append(f"{mint or 'asset'} needs 1 to {LIMITS['maxOracles']} oracles")
        weights = [_num(oracle.get("weightBps")) for oracle in oracles]
        if any(weight is None or int(weight) != weight or weight < 0 for weight in weights):
            errors.append(f"{mint} oracle weightBps must be integers")
        elif int(sum(weights)) != WEIGHT_TOTAL:
            errors.append(f"{mint} oracle weights must sum to {WEIGHT_TOTAL}")
        min_oracles = _num(asset.get("minOracles")) or 1
        min_conf = _num(asset.get("minConfBps"))
        conf_thresh = _num(asset.get("confThreshBps"))
        if min_conf is None or conf_thresh is None or min_conf >= conf_thresh:
            errors.append(f"{mint} minConfBps must be lower than confThreshBps")
        normalized.append({
            "mint": mint,
            "symbol": asset.get("symbol") or "",
            "decimals": asset.get("decimals") if isinstance(asset.get("decimals"), int) else 0,
            "targetBps": int(target or 0),
            "minOracles": min_oracles,
            "minConfBps": min_conf or 0,
            "confThreshBps": conf_thresh or 0,
            "maxStaleSec": _num(asset.get("maxStaleSec")) if asset.get("maxStaleSec") is not None else 120,
            "oracles": [{
                "source": str(oracle.get("source") or ""),
                "weightBps": int(_num(oracle.get("weightBps")) or 0),
                "required": bool(oracle.get("required")),
            } for oracle in oracles],
        })
    if normalized and sum(asset["targetBps"] for asset in normalized) != WEIGHT_TOTAL:
        errors.append(f"target weights must sum to {WEIGHT_TOTAL}")
    deviation = _num(data.get("deviationBps"))
    cooldown = _num(data.get("cooldownSec"))
    if deviation is None or deviation <= 0 or deviation > WEIGHT_TOTAL:
        errors.append("deviationBps must be between 1 and 10000")
    if cooldown is None or cooldown < 0:
        errors.append("cooldownSec must be zero or more")
    if errors:
        return _fail(errors)
    vault = {
        "name": data["name"].strip(),
        "chain": "solana",
        "assets": normalized,
        "deviationBps": deviation,
        "cooldownSec": cooldown,
        "automation": data.get("automation") is not False,
        "dustUsd": _num(data.get("dustUsd")) if data.get("dustUsd") is not None else 0.01,
        "windowUtc": data.get("windowUtc"),
        "managers": managers,
    }
    return {
        "ok": True,
        "version": VERSION,
        "executes": False,
        "vault": vault,
        "receipt": {"kind": "vault-plan", "version": VERSION, "name": vault["name"], "assets": len(vault["assets"]), "holdsFunds": False, "chainWrites": False},
    }


def _in_window(now_sec, window):
    if not window:
        return True
    hour = datetime.fromtimestamp(now_sec, timezone.utc).hour
    start = window.get("startHourUtc")
    end = window.get("endHourUtc")
    if not isinstance(start, int) or not isinstance(end, int):
        return False
    if start == end:
        return True
    if start < end:
        return start <= hour < end
    return hour >= start or hour < end


def _price_asset(asset, quotes, now_sec):
    fresh = []
    problems = []
    for oracle in asset["oracles"]:
        quote = next((item for item in (quotes or []) if item.get("source") == oracle["source"]), None)
        if quote is None:
            if oracle["required"]:
                problems.append(f"{asset['symbol'] or asset['mint']} missing required oracle {oracle['source']}")
            continue
        usd = _num(quote.get("usd"))
        conf = _num(quote.get("confBps"))
        updated = _num(quote.get("updatedAt"))
        if usd is None or usd <= 0 or conf is None or updated is None:
            problems.append(f"{oracle['source']} quote is not usable")
            continue
        if now_sec - updated > asset["maxStaleSec"]:
            if oracle["required"]:
                problems.append(f"{oracle['source']} is stale")
            continue
        if conf > asset["confThreshBps"]:
            if oracle["required"]:
                problems.append(f"{oracle['source']} confidence {int(conf)} bps is wider than {asset['confThreshBps']}")
            continue
        fresh.append({**oracle, "usd": usd, "confBps": conf})
    if problems:
        return {"ok": False, "problems": problems}
    if len(fresh) < asset["minOracles"]:
        return {"ok": False, "problems": [f"{asset['symbol'] or asset['mint']} has {len(fresh)} usable oracles, needs {asset['minOracles']}"]}
    weight = sum(item["weightBps"] for item in fresh)
    usd = sum(item["usd"] * (item["weightBps"] / weight) for item in fresh)
    conf = max(item["confBps"] for item in fresh)
    if conf < asset["minConfBps"]:
        return {"ok": False, "problems": [f"{asset['symbol'] or asset['mint']} confidence collapsed below minConfBps"]}
    return {"ok": True, "usd": usd, "confBps": conf, "sources": [item["source"] for item in fresh]}


def quote_vault(vault=None, book=None, now=None):
    planned = plan_vault(vault or {})
    if not planned["ok"]:
        return planned
    spec = planned["vault"]
    book = book or {}
    now_sec = _num(now) if now is not None else datetime.now(timezone.utc).timestamp()
    balances = book.get("balances") or {}
    quotes = book.get("quotes") or {}
    rows = []
    problems = []
    for asset in spec["assets"]:
        units = _num(balances.get(asset["mint"]))
        if units is None or units < 0:
            problems.append(f"missing balance for {asset['symbol'] or asset['mint']}")
            continue
        priced = _price_asset(asset, quotes.get(asset["mint"]), now_sec)
        if not priced["ok"]:
            problems.extend(priced["problems"])
            continue
        rows.append({**asset, "units": units, "usd": priced["usd"], "valueUsd": units * priced["usd"], "confBps": priced["confBps"], "sources": priced["sources"]})
    if problems:
        return {"ok": False, "version": VERSION, "executes": False, "errors": problems}
    nav = sum(row["valueUsd"] for row in rows)
    if nav <= 0:
        return _fail(["nav is zero"])
    weighted = []
    for row in rows:
        current = round((row["valueUsd"] / nav) * WEIGHT_TOTAL)
        weighted.append({**row, "currentBps": current, "driftBps": current - row["targetBps"]})
    drift_fix = WEIGHT_TOTAL - sum(row["currentBps"] for row in weighted)
    if drift_fix and weighted:
        weighted[-1]["currentBps"] += drift_fix
        weighted[-1]["driftBps"] = weighted[-1]["currentBps"] - weighted[-1]["targetBps"]
    max_drift = max(abs(row["driftBps"]) for row in weighted)
    last = _num(book.get("lastRebalanceAt"))
    cooldown_left = 0 if last is None else max(0, spec["cooldownSec"] - (now_sec - last))
    blocked = None
    if not spec["automation"]:
        blocked = "automation is off"
    elif not _in_window(now_sec, spec["windowUtc"]):
        blocked = "outside the keeper window"
    elif cooldown_left > 0:
        blocked = f"cooldown has {int(cooldown_left)}s left"
    elif max_drift < spec["deviationBps"]:
        blocked = f"max drift {max_drift} bps is inside {spec['deviationBps']}"
    trades = []
    for row in weighted:
        usd = ((row["targetBps"] - row["currentBps"]) / WEIGHT_TOTAL) * nav
        if abs(usd) < spec["dustUsd"]:
            continue
        trades.append({
            "mint": row["mint"],
            "symbol": row["symbol"],
            "side": "buy" if usd > 0 else "sell",
            "usd": abs(usd),
            "targetBps": row["targetBps"],
            "currentBps": row["currentBps"],
        })
    return {
        "ok": True,
        "version": VERSION,
        "executes": False,
        "navUsd": nav,
        "maxDriftBps": max_drift,
        "needsRebalance": blocked is None,
        "blocked": blocked,
        "rows": [{
            "mint": row["mint"], "symbol": row["symbol"], "units": row["units"], "priceUsd": row["usd"],
            "valueUsd": row["valueUsd"], "targetBps": row["targetBps"], "currentBps": row["currentBps"],
            "driftBps": row["driftBps"], "confBps": row["confBps"], "sources": row["sources"],
        } for row in weighted],
        "trades": trades,
        "receipt": {
            "kind": "vault-wait" if blocked else "vault-rebalance-intent",
            "version": VERSION,
            "navUsd": nav,
            "maxDriftBps": max_drift,
            "trades": [] if blocked else trades,
            "chainWrites": False,
            "signed": False,
        },
    }


def keeper_step(vault=None, book=None, now=None):
    quote = quote_vault(vault, book, now)
    if not quote["ok"]:
        return {**quote, "action": "halt"}
    if not quote["needsRebalance"]:
        return {**quote, "action": "wait"}
    return {**quote, "action": "intent", "intent": {
        "type": "rebalance",
        "caller": "any",
        "trades": quote["trades"],
        "note": "Permissionless to compute. This process does not sign, swap, or move tokens.",
    }}
