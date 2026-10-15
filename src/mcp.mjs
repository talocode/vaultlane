import { keeperStep, planVault, VERSION } from "./engine.mjs";
import { creditPrices } from "./prices.mjs";

const tools = [
  {
    name: "vaultlane_plan",
    description: "Validate a multi-token vault spec. Does not deploy a program or mint a vault token.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        assets: { type: "array" },
        deviationBps: { type: "integer" },
        cooldownSec: { type: "integer" },
        automation: { type: "boolean" },
      },
      required: ["name", "assets", "deviationBps", "cooldownSec"],
    },
  },
  {
    name: "vaultlane_keeper",
    description: "Price a vault book and emit a rebalance intent or a wait. Does not sign or send a transaction.",
    inputSchema: {
      type: "object",
      properties: {
        vault: { type: "object" },
        book: { type: "object" },
        now: { type: "integer" },
      },
      required: ["vault", "book"],
    },
  },
  {
    name: "vaultlane_prices",
    description: "Read the Talocode credit catalog and the live pricing endpoint. Local VaultLane calls cost 0.",
    inputSchema: { type: "object", properties: {} },
  },
];

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

export function startMcp() {
  process.stdin.setEncoding("utf8");
  let buffer = "";
  process.stdin.on("data", async (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let request;
      try {
        request = JSON.parse(line);
      } catch {
        continue;
      }
      const { id, method, params } = request;
      if (method === "initialize") {
        send({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "vaultlane", version: VERSION }, capabilities: { tools: {} } } });
      } else if (method === "tools/list") {
        send({ jsonrpc: "2.0", id, result: { tools } });
      } else if (method === "tools/call") {
        const name = params?.name;
        const args = params?.arguments || {};
        const result = name === "vaultlane_plan"
          ? planVault(args)
          : name === "vaultlane_keeper"
            ? keeperStep(args)
            : name === "vaultlane_prices"
              ? await creditPrices()
              : { ok: false, errors: [`unknown tool ${name}`] };
        send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }], isError: result.ok === false } });
      } else if (id !== undefined) {
        send({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
      }
    }
  });
}
