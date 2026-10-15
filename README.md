# VaultLane

VaultLane is the keeper rule layer for a multi-token Talocode vault. It checks weights, oracle confidence, drift, cooldown, and the keeper window. It writes an intent. It does not deploy a Solana program, mint a vault token, or send a swap.

The shape comes from [Symmetry](https://docs.symmetry.fi/llms.txt). Their program holds funds and pays keepers. This package stops before that.

```bash
npm install -g @talocode/vaultlane
vaultlane plan --file=examples/builder.json
vaultlane quote --file=examples/builder.json --book=examples/book.json --now=1760000000
vaultlane prices
```

Python:

```bash
pip install talocode-vaultlane
vaultlane quote --file=builder.json --book=book.json
vaultlane prices
```

SDK:

```js
import { creditPrices, keeperStep, planVault } from "@talocode/vaultlane";
```

```py
from talocode_vaultlane import credit_prices, keeper_step, plan_vault
```

## What the sample book does

The basket is 50% SOL, 30% USDC, and 20% official $TCODE (`6ptxwABxQz8zMhwhiPeVgRgWjGMdVcEBFBv8v8C3ory`). On the sample book the keeper says sell $200 of SOL, buy $100 of USDC, and buy $100 of $TCODE. `signed` is false.

A stale required price halts the keeper. A cooldown makes it wait. Prices in the sample are manual. Jupiter's price feed for this mint is empty while it is still on the Orynth curve, and a missing required oracle is a halt, not a guess.

## Credits

`vaultlane prices` reads `data/credit-prices.json`, pulled 15 October 2026 from [talocode.site/pricing.html](https://talocode.site/pricing.html) and [the live endpoint](https://api.talocode.site/api/v1/cloud/pricing).

- 1 credit = $0.01. Credits are product usage, not cash.
- The public page lists 43 actions. The live body that day listed Tera, SearchLane, and CalcLane only.
- VaultLane is not in that live body. Local `plan`, `quote`, and `keeper` cost 0 credits.
- `POST /execute` on the local server returns HTTP 402. It does not charge, sign, or swap.

```bash
vaultlane mcp
vaultlane serve --port=8792
```

`GET /health`, `GET /prices`, `POST /plan`, `POST /keeper`, and `POST /execute` are local. They are not mounted on api.talocode.site.

## Not shipped

A Solana program, a vault-token mint, a Dutch auction, and a keeper bounty. Do not describe this package as a place to deposit funds.
