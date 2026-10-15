export const VERSION = "0.1.1";
export const WEIGHT_TOTAL = 10_000;
export const LIMITS = { maxAssets: 100, maxOracles: 4, maxManagers: 10 };

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function fail(errors) {
  return { ok: false, version: VERSION, errors, executes: false };
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

export function planVault(input = {}) {
  const errors = [];
  const assets = Array.isArray(input.assets) ? input.assets : null;
  if (!input.name || typeof input.name !== "string") errors.push("name is required");
  if (!assets || assets.length === 0) errors.push("at least one asset is required");
  if (assets && assets.length > LIMITS.maxAssets) errors.push(`a vault holds at most ${LIMITS.maxAssets} assets`);
  const managers = Array.isArray(input.managers) ? input.managers : [];
  if (managers.length > LIMITS.maxManagers) errors.push(`a vault has at most ${LIMITS.maxManagers} managers`);

  const normalized = [];
  const seen = new Set();
  for (const asset of assets || []) {
    const mint = String(asset.mint || "");
    const targetBps = num(asset.targetBps);
    if (!MINT.test(mint)) errors.push(`bad mint: ${mint || "(empty)"}`);
    if (seen.has(mint)) errors.push(`duplicate mint: ${mint}`);
    seen.add(mint);
    if (targetBps === null || !Number.isInteger(targetBps) || targetBps < 0) errors.push(`${mint || asset.symbol || "asset"} targetBps must be a non-negative integer`);
    const oracles = Array.isArray(asset.oracles) ? asset.oracles : [];
    if (oracles.length === 0 || oracles.length > LIMITS.maxOracles) errors.push(`${mint || "asset"} needs 1 to ${LIMITS.maxOracles} oracles`);
    const weights = oracles.map((oracle) => num(oracle.weightBps));
    if (weights.some((weight) => weight === null || !Number.isInteger(weight) || weight < 0)) errors.push(`${mint} oracle weightBps must be integers`);
    else if (sum(weights) !== WEIGHT_TOTAL) errors.push(`${mint} oracle weights must sum to ${WEIGHT_TOTAL}`);
    const minOracles = num(asset.minOracles) ?? 1;
    const minConfBps = num(asset.minConfBps);
    const confThreshBps = num(asset.confThreshBps);
    if (minConfBps === null || confThreshBps === null || minConfBps >= confThreshBps) errors.push(`${mint} minConfBps must be lower than confThreshBps`);
    normalized.push({
      mint,
      symbol: asset.symbol || "",
      decimals: Number.isInteger(asset.decimals) ? asset.decimals : 0,
      targetBps: targetBps ?? 0,
      minOracles,
      minConfBps: minConfBps ?? 0,
      confThreshBps: confThreshBps ?? 0,
      maxStaleSec: num(asset.maxStaleSec) ?? 120,
      oracles: oracles.map((oracle) => ({
        source: String(oracle.source || ""),
        weightBps: num(oracle.weightBps) || 0,
        required: Boolean(oracle.required),
      })),
    });
  }
  if (normalized.length && sum(normalized.map((asset) => asset.targetBps)) !== WEIGHT_TOTAL) {
    errors.push(`target weights must sum to ${WEIGHT_TOTAL}`);
  }
  const deviationBps = num(input.deviationBps);
  if (deviationBps === null || deviationBps <= 0 || deviationBps > WEIGHT_TOTAL) errors.push("deviationBps must be between 1 and 10000");
  const cooldownSec = num(input.cooldownSec);
  if (cooldownSec === null || cooldownSec < 0) errors.push("cooldownSec must be zero or more");
  if (errors.length) return fail(errors);

  const vault = {
    name: input.name.trim(),
    chain: "solana",
    assets: normalized,
    deviationBps,
    cooldownSec,
    automation: input.automation !== false,
    dustUsd: num(input.dustUsd) ?? 0.01,
    windowUtc: input.windowUtc || null,
    managers,
  };
  return {
    ok: true,
    version: VERSION,
    executes: false,
    vault,
    receipt: {
      kind: "vault-plan",
      version: VERSION,
      name: vault.name,
      assets: vault.assets.length,
      holdsFunds: false,
      chainWrites: false,
    },
  };
}

function inWindow(nowSec, windowUtc) {
  if (!windowUtc) return true;
  const hour = new Date(nowSec * 1000).getUTCHours();
  const start = Number(windowUtc.startHourUtc);
  const end = Number(windowUtc.endHourUtc);
  if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

function priceAsset(asset, quotes, nowSec) {
  const fresh = [];
  const problems = [];
  for (const oracle of asset.oracles) {
    const quote = (quotes || []).find((item) => item.source === oracle.source);
    if (!quote) {
      if (oracle.required) problems.push(`${asset.symbol || asset.mint} missing required oracle ${oracle.source}`);
      continue;
    }
    const usd = num(quote.usd);
    const confBps = num(quote.confBps);
    const updatedAt = num(quote.updatedAt);
    if (usd === null || usd <= 0 || confBps === null || updatedAt === null) {
      problems.push(`${oracle.source} quote is not usable`);
      continue;
    }
    if (nowSec - updatedAt > asset.maxStaleSec) {
      if (oracle.required) problems.push(`${oracle.source} is stale`);
      continue;
    }
    if (confBps > asset.confThreshBps) {
      if (oracle.required) problems.push(`${oracle.source} confidence ${confBps} bps is wider than ${asset.confThreshBps}`);
      continue;
    }
    fresh.push({ ...oracle, usd, confBps });
  }
  if (problems.length) return { ok: false, problems };
  if (fresh.length < asset.minOracles) return { ok: false, problems: [`${asset.symbol || asset.mint} has ${fresh.length} usable oracles, needs ${asset.minOracles}`] };
  const weight = sum(fresh.map((item) => item.weightBps));
  const usd = fresh.reduce((total, item) => total + item.usd * (item.weightBps / weight), 0);
  const confBps = Math.max(...fresh.map((item) => item.confBps));
  if (confBps < asset.minConfBps) return { ok: false, problems: [`${asset.symbol || asset.mint} confidence collapsed below minConfBps`] };
  return { ok: true, usd, confBps, sources: fresh.map((item) => item.source) };
}

export function quoteVault({ vault, book = {}, now } = {}) {
  const planned = planVault(vault || {});
  if (!planned.ok) return planned;
  const spec = planned.vault;
  const nowSec = num(now) ?? Math.floor(Date.now() / 1000);
  const balances = book.balances || {};
  const quotes = book.quotes || {};
  const rows = [];
  const problems = [];
  for (const asset of spec.assets) {
    const units = num(balances[asset.mint]);
    if (units === null || units < 0) {
      problems.push(`missing balance for ${asset.symbol || asset.mint}`);
      continue;
    }
    const priced = priceAsset(asset, quotes[asset.mint], nowSec);
    if (!priced.ok) {
      problems.push(...priced.problems);
      continue;
    }
    rows.push({ ...asset, units, usd: priced.usd, valueUsd: units * priced.usd, confBps: priced.confBps, sources: priced.sources });
  }
  if (problems.length) return { ok: false, version: VERSION, executes: false, errors: problems };
  const navUsd = sum(rows.map((row) => row.valueUsd));
  if (navUsd <= 0) return fail(["nav is zero"]);
  const weighted = rows.map((row) => {
    const currentBps = Math.round((row.valueUsd / navUsd) * WEIGHT_TOTAL);
    const driftBps = currentBps - row.targetBps;
    return { ...row, currentBps, driftBps };
  });
  const driftFix = WEIGHT_TOTAL - sum(weighted.map((row) => row.currentBps));
  if (driftFix !== 0 && weighted.length) weighted[weighted.length - 1].currentBps += driftFix;
  weighted[weighted.length - 1].driftBps = weighted[weighted.length - 1].currentBps - weighted[weighted.length - 1].targetBps;
  const maxDrift = Math.max(...weighted.map((row) => Math.abs(row.driftBps)));
  const last = num(book.lastRebalanceAt);
  const cooldownLeft = last === null ? 0 : Math.max(0, spec.cooldownSec - (nowSec - last));
  const windowOpen = inWindow(nowSec, spec.windowUtc);
  let blocked = null;
  if (!spec.automation) blocked = "automation is off";
  else if (!windowOpen) blocked = "outside the keeper window";
  else if (cooldownLeft > 0) blocked = `cooldown has ${cooldownLeft}s left`;
  else if (maxDrift < spec.deviationBps) blocked = `max drift ${maxDrift} bps is inside ${spec.deviationBps}`;
  const trades = weighted
    .map((row) => {
      const usd = ((row.targetBps - row.currentBps) / WEIGHT_TOTAL) * navUsd;
      return {
        mint: row.mint,
        symbol: row.symbol,
        side: usd > 0 ? "buy" : "sell",
        usd: Math.abs(usd),
        targetBps: row.targetBps,
        currentBps: row.currentBps,
      };
    })
    .filter((trade) => trade.usd >= spec.dustUsd);
  return {
    ok: true,
    version: VERSION,
    executes: false,
    navUsd,
    maxDriftBps: maxDrift,
    needsRebalance: blocked === null,
    blocked,
    rows: weighted.map((row) => ({
      mint: row.mint,
      symbol: row.symbol,
      units: row.units,
      priceUsd: row.usd,
      valueUsd: row.valueUsd,
      targetBps: row.targetBps,
      currentBps: row.currentBps,
      driftBps: row.driftBps,
      confBps: row.confBps,
      sources: row.sources,
    })),
    trades,
    receipt: {
      kind: blocked ? "vault-wait" : "vault-rebalance-intent",
      version: VERSION,
      navUsd,
      maxDriftBps: maxDrift,
      trades: blocked ? [] : trades,
      chainWrites: false,
      signed: false,
    },
  };
}

export function keeperStep(input) {
  const quote = quoteVault(input);
  if (!quote.ok) return { ...quote, action: "halt" };
  if (!quote.needsRebalance) return { ...quote, action: "wait" };
  return {
    ...quote,
    action: "intent",
    intent: {
      type: "rebalance",
      caller: "any",
      trades: quote.trades,
      note: "Permissionless to compute. This process does not sign, swap, or move tokens.",
    },
  };
}
