import { createServer } from "node:http";
import { keeperStep, planVault, VERSION } from "./engine.mjs";

export function startServer(port = 8792) {
  return createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, version: VERSION, executes: false }));
      return;
    }
    if (req.method !== "POST" || (req.url !== "/plan" && req.url !== "/keeper")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, errors: ["unknown endpoint"] }));
      return;
    }
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, errors: ["body is not json"] }));
        return;
      }
      const result = req.url === "/plan" ? planVault(body) : keeperStep(body);
      res.writeHead(result.ok ? 200 : 422, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
    });
  }).listen(port);
}
