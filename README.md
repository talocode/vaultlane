# VaultLane

VaultLane is the first on-chain vault layer for Talocode. It is the rule engine a keeper would run. It is not a deployed Solana program.

The shape comes from [Symmetry](https://docs.symmetry.fi/llms.txt): a basket of token mints, target weights in basis points that sum to 10,000, up to four oracle sources per asset, and a permissionless keeper that is allowed to act only when automation, the deviation band, the cooldown, and the price confidence all agree.

Symmetry then does something this package does not. Their program `BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate` holds the tokens, mints a vault token, runs a Dutch auction, and pays the keeper. VaultLane stops at the intent.

```bash
node bin/vaultlane.mjs plan --file=examples/builder.json
node bin/vaultlane.mjs quote --file=examples/builder.json --book=examples/book.json --now=1760000000
```

`quote` prints either `action: "intent"`, `action: "wait"`, or `action: "halt"`. An intent lists the buy and sell notionals in USD. Nothing is signed. Nothing is sent.

The example basket is 50% SOL, 30% USDC, and 20% official $TCODE (`6ptxwABxQz8zMhwhiPeVgRgWjGMdVcEBFBv8v8C3ory`). The book uses manual prices on purpose. Jupiter's price feed for that mint is empty while it is still on the Orynth curve, and a missing required oracle halts the keeper instead of inventing a price.

## What a later program would add

- A vault account and a vault-token mint.
- Deposits and withdrawals as the same rebalance intent, which is how Symmetry does it.
- An on-chain oracle update before any swap.
- A bounty a permissionless caller can claim after the work is done.

Until that program exists, do not describe VaultLane as a place funds can be deposited.

## Local API and MCP

```bash
node bin/vaultlane.mjs serve --port=8792
node bin/vaultlane.mjs mcp
```

`GET /health`, `POST /plan`, and `POST /keeper` are local. They are not mounted on api.talocode.site.

SDK:

```js
import { keeperStep, planVault } from "@talocode/vaultlane";
```

The package is not on npm yet.
