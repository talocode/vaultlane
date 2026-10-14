#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { keeperStep, planVault } from "../src/engine.mjs";
import { startMcp } from "../src/mcp.mjs";
import { startServer } from "../src/server.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(rest.filter((arg) => arg.startsWith("--")).map((arg) => {
  const [key, value] = arg.slice(2).split("=");
  return [key, value ?? true];
}));

function usage() {
  process.stderr.write(`Usage:
  vaultlane plan --file=examples/builder.json
  vaultlane quote --file=examples/builder.json --book=examples/book.json
  vaultlane mcp
  vaultlane serve --port=8792

VaultLane checks weights, oracles, drift, cooldown, and the keeper window.
It writes an intent. It does not deploy a program, mint a vault token, or send a swap.
`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

if (cmd === "mcp") {
  startMcp();
} else if (cmd === "serve") {
  const server = startServer(Number(flags.port || 8792));
  server.on("listening", () => process.stderr.write(`vaultlane listening on ${server.address().port}\n`));
} else if (cmd === "plan") {
  if (!flags.file) {
    usage();
    process.exit(2);
  }
  const result = planVault(await readJson(flags.file));
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(result.ok ? 0 : 1);
} else if (cmd === "quote") {
  if (!flags.file || !flags.book) {
    usage();
    process.exit(2);
  }
  const result = keeperStep({ vault: await readJson(flags.file), book: await readJson(flags.book), now: flags.now ? Number(flags.now) : undefined });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(result.ok ? 0 : 1);
} else {
  usage();
  process.exit(cmd ? 2 : 0);
}
