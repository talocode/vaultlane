# talocode-vaultlane

Python CLI and SDK for VaultLane. Same rules as the Node package. Local plan, quote, and the credit catalog. No program. No swap.

```bash
pip install talocode-vaultlane
vaultlane quote --file=builder.json --book=book.json
vaultlane prices
```

`vaultlane prices` reads the catalog shipped in this package and tries the live endpoint. Local calls cost 0 credits. If VaultLane is absent from the live body, the command says so.
