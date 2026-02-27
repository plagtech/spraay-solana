# 💧 Spraay Solana SDK

Batch payment SDK for Solana — send SOL and SPL tokens (USDC, USDT, etc.) to multiple recipients in optimized transactions.

Part of the [Spraay](https://spraay.app) multi-chain batch payment protocol, live on **11 chains**.

> ✅ **Tested on Devnet** — [View SOL batch tx](https://explorer.solana.com/tx/51ZA2pSv12tvSbGXDseLftCKY16Ly84ccxwAzMfCYHx5LLzeicoCuhkmrstATK3EDmkAwvB8r2vfi5U9J7Gn4uER?cluster=devnet) · [View USDC batch tx](https://explorer.solana.com/tx/5Hw3Vv5YsR6h9sSXoysT2t4fZTKJqNzwkkncpPG32Nra5jGZSAjUefZPydaCTuEgC4dpzSMoJKosmLrU3fCxTkPb?cluster=devnet)

## Features

- **Batch SOL transfers** — send SOL to 200+ recipients
- **Batch SPL token transfers** — send USDC, USDT, or any SPL token to multiple recipients
- **Auto ATA creation** — automatically creates Associated Token Accounts for new recipients
- **Smart chunking** — splits large batches into optimally-sized transactions (respects 1232-byte limit)
- **Staggered sending** — prevents rate limiting on RPC nodes
- **Cost estimation** — estimate transaction fees and rent costs before sending
- **Fee collection** — 0.3% protocol fee routed to Spraay treasury
- **Web dApp** — browser-based UI with Phantom wallet integration

## Test Results (Devnet)

```
╔══════════════════════════════════════════════════════╗
║    💧 Spraay Solana SDK — Full Test Suite           ║
╚══════════════════════════════════════════════════════╝

📊 Cost Estimates
  200 SOL recipients:           14 txs, 0.000070 SOL in fees
  200 USDC (new ATAs):          29 txs, 0.408001 SOL total
  200 USDC (existing ATAs):     14 txs, 0.000070 SOL in fees

💰 Batch SOL Transfer:          3 recipients, 1 tx   ✅
💵 Batch USDC Transfer:         3 recipients, 1 tx   ✅  (auto ATA creation)
🔥 Stress Test:                 10 recipients = 1 tx, 15 recipients = 2 txs ✅
```

## Installation

```bash
git clone https://github.com/plagtech/spraay-solana.git
cd spraay-solana
npm install
npm run build
```

## Quick Start

### Batch Send SOL

```typescript
import { Keypair } from "@solana/web3.js";
import { SpraySolana } from "@spraay/solana-sdk";

const spraay = new SpraySolana({
  rpcUrl: "https://api.mainnet-beta.solana.com",
});

const sender = Keypair.fromSecretKey(/* your secret key */);

const result = await spraay.batchSendSol(sender, [
  { address: "Abc...111", amount: 0.5 },
  { address: "Def...222", amount: 1.0 },
  { address: "Ghi...333", amount: 0.25 },
]);

console.log(`Sent ${result.totalAmount} SOL to ${result.totalRecipients} recipients`);
console.log(`Used ${result.transactionCount} transactions`);
```

### Batch Send USDC

```typescript
import { SpraySolana, KNOWN_TOKENS } from "@spraay/solana-sdk";

const spraay = new SpraySolana({
  rpcUrl: "https://api.mainnet-beta.solana.com",
});

const result = await spraay.batchSendUSDC(sender, [
  { address: "Abc...111", amount: 50 },
  { address: "Def...222", amount: 100 },
  { address: "Ghi...333", amount: 25.50 },
]);
```

### Batch Send Any SPL Token

```typescript
import { PublicKey } from "@solana/web3.js";

const BONK_MINT = new PublicKey("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");

const result = await spraay.batchSendToken(sender, BONK_MINT, [
  { address: "Abc...111", amount: 1000000 },
  { address: "Def...222", amount: 500000 },
]);
```

### Estimate Cost

```typescript
const estimate = spraay.estimateCost(200, true, 200);
console.log(`Total cost: ~${estimate.totalCostSol.toFixed(4)} SOL`);
console.log(`Transactions needed: ${estimate.transactionCount}`);
```

## How It Works

Unlike EVM chains where you need a smart contract to batch transfers, Solana natively supports multiple instructions per transaction. Spraay leverages this:

1. **Build instructions** — creates a transfer instruction per recipient
2. **Auto-create ATAs** — detects which recipients need new token accounts
3. **Smart chunking** — packs instructions into transactions respecting the 1232-byte limit
4. **Staggered sending** — sends transactions with controlled timing to avoid rate limits
5. **Fee collection** — adds a 0.3% protocol fee transfer to each batch

### Transaction Size Limits

| Transfer Type | Max Recipients/Tx | Why |
|---|---|---|
| SOL | ~14 | Each transfer = ~52 bytes |
| SPL (existing ATA) | ~14 | Each transfer = ~72 bytes |
| SPL (new ATA) | ~7 | Each needs create ATA (~120 bytes) + transfer |

For large batches (100+ recipients), the SDK automatically splits into multiple transactions.

## Why Solana?

| Metric | Solana | EVM (Base) | EVM (Ethereum) |
|---|---|---|---|
| Tx confirmation | ~400ms | ~2s | ~12s |
| Cost (200 recipients) | ~$0.01 | ~$0.50 | ~$5-50 |
| Native batching | ✅ Built-in | ❌ Needs contract | ❌ Needs contract |
| Max recipients/tx | ~14 (auto-chunks) | 200 | 200 |

## Configuration

```typescript
const spraay = new SpraySolana({
  rpcUrl: "https://api.mainnet-beta.solana.com",
  feePercent: 0.3,
  commitment: "confirmed",
  txDelayMs: 200,
});
```

## Testing on Devnet

```bash
npm test
```

Runs the full test suite on Solana devnet: cost estimates, batch SOL, batch USDC (with auto ATA creation), and stress test.

## Spraay Multi-Chain

Spraay is live on 11 chains:

| Chain | Contract/SDK |
|---|---|
| 🔵 Base | `0x1646452F98E36A3c9Cfc3eDD8868221E207B5eEC` |
| ⟠ Ethereum | `0x1646452F98E36A3c9Cfc3eDD8868221E207B5eEC` |
| ⬡ Arbitrum | `0x08fA5D1c16CD6E2a16FC0E4839f262429959E073` |
| 🟣 Polygon | `0x6d2453ab7416c99aeDCA47CF552695be5789D7ff` |
| 🟡 BNB Chain | `0x3093a2951FB77b3beDfB8BA20De645F7413432C1` |
| 🔺 Avalanche | `0x0613800F110A5baF830d15944f4AD783F066A650` |
| 🦄 Unichain | `0x08fA5D1c16CD6E2a16FC0E4839f262429959E073` |
| 🟢 Plasma | `0x08fA5D1c16CD6E2a16FC0E4839f262429959E073` |
| 🔶 BOB | `0xEc8599026AE70898391a71c96AA82d4840C2e973` |
| 🧠 Bittensor | Native (`utility.batch_all`) |
| ◎ Solana | TypeScript SDK ([this repo](https://github.com/plagtech/spraay-solana)) |

## Links

- 🌐 [Spraay App](https://spraay.app) — Web dApp (all chains)
- 🤖 [x402 Gateway](https://gateway.spraay.app) — AI agent payment gateway
- 🐦 [Twitter](https://twitter.com/Spraay_app)
- 💻 [GitHub](https://github.com/plagtech)

## License

MIT
