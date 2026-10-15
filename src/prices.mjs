import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "./engine.mjs";

const file = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "credit-prices.json");

export async function creditPrices() {
  const catalog = JSON.parse(await readFile(file, "utf8"));
  let live = null;
  let liveError = null;
  try {
    const response = await fetch(catalog.sources.live, { headers: { "user-agent": `talocode-vaultlane/${VERSION}` } });
    if (!response.ok) throw new Error(String(response.status));
    live = await response.json();
  } catch (error) {
    liveError = error.message;
  }
  const liveProducts = Object.keys(live?.data?.pricing || {});
  return {
    ok: true,
    product: "@talocode/vaultlane",
    version: VERSION,
    catalog,
    live,
    liveError,
    vaultlaneOnLiveEndpoint: liveProducts.includes("vaultlane"),
    disclaimer: "Prices are copied from Talocode's public page and the live pricing endpoint. 1 credit = $0.01. Credits are product usage, not cash. Local VaultLane calls cost 0.",
  };
}
