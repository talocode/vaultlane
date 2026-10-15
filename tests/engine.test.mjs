import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { keeperStep, planVault } from "../src/engine.mjs";
import { creditPrices } from "../src/prices.mjs";
import { startServer } from "../src/server.mjs";

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

test("local vaultlane calls cost zero and the live catalog has no vaultlane row", async () => {
  const prices = await creditPrices();
  assert.equal(prices.ok, true);
  assert.equal(prices.catalog.localVaultlane.credits, 0);
  assert.equal(prices.catalog.creditUsd, 0.01);
  assert.equal(prices.vaultlaneOnLiveEndpoint, false);
  assert.equal(prices.catalog.pulledAt, "2026-10-15");
});

test("execute is refused with HTTP 402 and no signature", async () => {
  const server = startServer(8799);
  await new Promise((resolve) => server.on("listening", resolve));
  const response = await fetch("http://127.0.0.1:8799/execute", { method: "POST", body: "{}" });
  const body = await response.json();
  server.close();
  assert.equal(response.status, 402);
  assert.equal(body.signed, false);
  assert.equal(body.creditsCharged, 0);
  assert.equal(body.mint, "6ptxwABxQz8zMhwhiPeVgRgWjGMdVcEBFBv8v8C3ory");
});
