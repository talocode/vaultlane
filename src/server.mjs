import { createServer } from "node:http";
import { keeperStep, planVault, VERSION } from "./engine.mjs";
import { creditPrices } from "./prices.mjs";

const MINT = "6ptxwABxQz8zMhwhiPeVgRgWjGMdVcEBFBv8v8C3ory";

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export function startServer(port = 8792) {
  return createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      send(res, 200, { ok: true, version: VERSION, executes: false });
      return;
    }
    if (req.method === "GET" && req.url === "/prices") {
      creditPrices().then((body) => send(res, 200, body)).catch((error) => send(res, 500, { ok: false, errors: [error.message] }));
      return;
    }
    if (req.method === "POST" && req.url === "/execute") {
      send(res, 402, {
        ok: false,
        error: "payment_required",
        executes: false,
        signed: false,
        creditsCharged: 0,
        mint: MINT,
        note: "VaultLane will not execute a swap. Local plan and quote cost 0 credits. The live pricing endpoint has no VaultLane row, so there is nothing to charge and nothing to sign.",
      });
      return;
    }
    if (req.method !== "POST" || (req.url !== "/plan" && req.url !== "/keeper")) {
      send(res, 404, { ok: false, errors: ["unknown endpoint"] });
      return;
    }
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      } catch {
        send(res, 400, { ok: false, errors: ["body is not json"] });
        return;
      }
      const result = req.url === "/plan" ? planVault(body) : keeperStep(body);
      send(res, result.ok ? 200 : 422, result);
    });
  }).listen(port);
}
