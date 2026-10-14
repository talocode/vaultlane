import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { keeperStep, planVault } from "../src/engine.mjs";

const NOW = 1760000000;

async function load() {
  const vault = JSON.parse(await readFile(new URL("../examples/builder.json", import.meta.url), "utf8"));
  const book = JSON.parse(await readFile(new URL("../examples/book.json", import.meta.url), "utf8"));
  return { vault, book };
}

test("a plan refuses weights that do not sum to 10000", () => {
  const result = planVault({
    name: "bad",
    deviationBps: 100,
    cooldownSec: 0,
    assets: [
      { mint: "So11111111111111111111111111111111111111112", targetBps: 4000, minConfBps: 1, confThreshBps: 50, oracles: [{ source: "manual", weightBps: 10000 }] },
      { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", targetBps: 4000, minConfBps: 1, confThreshBps: 50, oracles: [{ source: "manual", weightBps: 10000 }] },
    ],
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /10000/);
});

test("the keeper emits a rebalance intent and does not execute it", async () => {
  const { vault, book } = await load();
  const result = keeperStep({ vault, book, now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.action, "intent");
  assert.equal(result.executes, false);
  assert.equal(result.receipt.signed, false);
  assert.equal(result.navUsd, 1000);
  const sol = result.trades.find((trade) => trade.symbol === "SOL");
  const usdc = result.trades.find((trade) => trade.symbol === "USDC");
  const tcode = result.trades.find((trade) => trade.symbol === "TCODE");
  assert.equal(sol.side, "sell");
  assert.equal(sol.usd, 200);
  assert.equal(usdc.side, "buy");
  assert.equal(usdc.usd, 100);
  assert.equal(tcode.side, "buy");
  assert.equal(tcode.usd, 100);
});

test("a stale required oracle halts the keeper", async () => {
  const { vault, book } = await load();
  book.quotes["6ptxwABxQz8zMhwhiPeVgRgWjGMdVcEBFBv8v8C3ory"][0].updatedAt = NOW - 500;
  const result = keeperStep({ vault, book, now: NOW });
  assert.equal(result.action, "halt");
  assert.match(result.errors.join(" "), /stale/);
});

test("cooldown blocks a second intent", async () => {
  const { vault, book } = await load();
  book.lastRebalanceAt = NOW - 10;
  const result = keeperStep({ vault, book, now: NOW });
  assert.equal(result.action, "wait");
  assert.match(result.blocked, /cooldown/);
  assert.deepEqual(result.receipt.trades, []);
});
