/**
 * Spraay Solana SDK — Full Test Suite
 *
 * Tests:
 *   1. Cost estimates for large batches
 *   2. Batch SOL transfer (3 recipients)
 *   3. Batch USDC transfer (3 recipients, devnet USDC)
 *   4. Stress test — max SOL recipients in a single transaction
 *
 * Run:   npm test
 *
 * Prerequisites:
 *   - npm install
 *   - solana config set --url devnet
 *   - Fund wallet with SOL: https://faucet.solana.com
 *   - Fund wallet with USDC: https://faucet.circle.com (select Solana)
 */

import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import { SpraySolana, KNOWN_TOKENS } from "../src/index";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ============================================================================
// Config
// ============================================================================

const DEVNET_RPC = "https://api.devnet.solana.com";

// Devnet USDC mint (from Circle faucet)
const DEVNET_USDC_MINT = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

// Load keypair
const keypairPath = path.join(os.homedir(), "devnet-test.json");
if (!fs.existsSync(keypairPath)) {
  console.error("❌ Keypair not found at ~/devnet-test.json");
  console.error(
    "   Run: solana-keygen new -o C:\\Users\\Hp\\devnet-test.json --no-bip39-passphrase"
  );
  process.exit(1);
}
const secretKey = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
const sender = Keypair.fromSecretKey(Uint8Array.from(secretKey));

// Initialize Spraay SDK
const spraay = new SpraySolana({
  rpcUrl: DEVNET_RPC,
  feePercent: 0.3,
  feeTreasury: sender.publicKey.toBase58(), // Fees return to sender in test
  commitment: "confirmed",
});

// ============================================================================
// Test 1: Cost Estimates
// ============================================================================

function testEstimates() {
  console.log("📊 TEST 1: Cost Estimates\n");

  const scenarios = [
    { recipients: 10, isToken: false, newAtas: 0, label: "10 SOL recipients" },
    { recipients: 50, isToken: false, newAtas: 0, label: "50 SOL recipients" },
    { recipients: 200, isToken: false, newAtas: 0, label: "200 SOL recipients" },
    { recipients: 10, isToken: true, newAtas: 10, label: "10 USDC (new ATAs)" },
    { recipients: 50, isToken: true, newAtas: 50, label: "50 USDC (new ATAs)" },
    { recipients: 200, isToken: true, newAtas: 200, label: "200 USDC (new ATAs)" },
    { recipients: 200, isToken: true, newAtas: 0, label: "200 USDC (existing ATAs)" },
  ];

  console.log(
    "  Scenario                    | Txs | Fees (SOL)  | Rent (SOL)  | Total (SOL)"
  );
  console.log(
    "  ----------------------------|-----|-------------|-------------|------------"
  );

  for (const s of scenarios) {
    const est = spraay.estimateCost(s.recipients, s.isToken, s.newAtas);
    console.log(
      `  ${s.label.padEnd(28)} | ${String(est.transactionCount).padStart(3)} | ${est.transactionFees.toFixed(6).padStart(11)} | ${est.rentCost.toFixed(6).padStart(11)} | ${est.totalCostSol.toFixed(6).padStart(10)}`
    );
  }

  console.log("\n  ✅ Cost estimates complete\n");
}

// ============================================================================
// Test 2: Batch SOL Transfer
// ============================================================================

async function testBatchSol() {
  console.log("💰 TEST 2: Batch SOL Transfer (3 recipients)\n");

  const recipients = [
    { address: Keypair.generate().publicKey, amount: 0.01 },
    { address: Keypair.generate().publicKey, amount: 0.01 },
    { address: Keypair.generate().publicKey, amount: 0.01 },
  ];

  console.log("  Sender:", sender.publicKey.toBase58());
  recipients.forEach((r, i) =>
    console.log(`  Recipient ${i + 1}: ${(r.address as PublicKey).toBase58()}`)
  );

  const balance = await spraay.getBalance(sender.publicKey);
  console.log(`\n  Sender balance: ${balance} SOL`);

  if (balance < 0.1) {
    console.log("  ❌ Insufficient SOL balance. Skipping.\n");
    return;
  }

  try {
    const result = await spraay.batchSendSol(sender, recipients);

    console.log(`\n  ✅ Batch SOL Transfer Complete!`);
    console.log(`     Recipients:   ${result.totalRecipients}`);
    console.log(`     Total sent:   ${result.totalAmount} SOL`);
    console.log(`     Spraay fee:   ${result.spraayFee} SOL`);
    console.log(`     Transactions: ${result.transactionCount}`);
    result.signatures.forEach((sig, i) =>
      console.log(
        `     Tx ${i + 1}: https://explorer.solana.com/tx/${sig}?cluster=devnet`
      )
    );

    // Verify
    for (let i = 0; i < recipients.length; i++) {
      const bal = await spraay.getBalance(recipients[i].address);
      console.log(`     Recipient ${i + 1} balance: ${bal} SOL`);
    }
  } catch (err) {
    console.log(`  ❌ Failed: ${(err as Error).message}`);
  }

  console.log();
}

// ============================================================================
// Test 3: Batch USDC Transfer
// ============================================================================

async function testBatchUSDC() {
  console.log("💵 TEST 3: Batch USDC Transfer (3 recipients)\n");

  const recipients = [
    { address: Keypair.generate().publicKey, amount: 1 },
    { address: Keypair.generate().publicKey, amount: 2 },
    { address: Keypair.generate().publicKey, amount: 1.5 },
  ];

  console.log("  Sender:", sender.publicKey.toBase58());
  console.log("  USDC Mint (devnet):", DEVNET_USDC_MINT.toBase58());
  recipients.forEach((r, i) =>
    console.log(`  Recipient ${i + 1}: ${(r.address as PublicKey).toBase58()} -> ${r.amount} USDC`)
  );

  // Check USDC balance
  const usdcBalance = await spraay.getTokenBalance(
    sender.publicKey,
    DEVNET_USDC_MINT
  );
  console.log(`\n  Sender USDC balance: ${usdcBalance} USDC`);

  if (usdcBalance < 5) {
    console.log("  ❌ Insufficient USDC. Get devnet USDC at https://faucet.circle.com");
    console.log("     Skipping USDC test.\n");
    return;
  }

  try {
    const result = await spraay.batchSendToken(
      sender,
      DEVNET_USDC_MINT,
      recipients
    );

    console.log(`\n  ✅ Batch USDC Transfer Complete!`);
    console.log(`     Recipients:   ${result.totalRecipients}`);
    console.log(`     Total sent:   ${result.totalAmount} USDC`);
    console.log(`     Spraay fee:   ${result.spraayFee} USDC`);
    console.log(`     Transactions: ${result.transactionCount}`);
    result.signatures.forEach((sig, i) =>
      console.log(
        `     Tx ${i + 1}: https://explorer.solana.com/tx/${sig}?cluster=devnet`
      )
    );

    // Verify recipient balances
    for (let i = 0; i < recipients.length; i++) {
      const bal = await spraay.getTokenBalance(
        recipients[i].address,
        DEVNET_USDC_MINT
      );
      console.log(`     Recipient ${i + 1} USDC balance: ${bal}`);
    }
  } catch (err) {
    console.log(`  ❌ Failed: ${(err as Error).message}`);
  }

  console.log();
}

// ============================================================================
// Test 4: Stress Test — Max SOL recipients in one transaction
// ============================================================================

async function testStressSOL() {
  console.log("🔥 TEST 4: Stress Test — How many SOL transfers fit in 1 tx?\n");

  const balance = await spraay.getBalance(sender.publicKey);
  console.log(`  Sender balance: ${balance} SOL`);

  // Try progressively larger batches
  const testSizes = [5, 10, 15, 20, 22, 25];

  for (const size of testSizes) {
    const needed = size * 0.001 + 0.01; // tiny amounts + fee buffer
    if (balance < needed) {
      console.log(`  ⏭ Skipping ${size} recipients — need ${needed.toFixed(3)} SOL`);
      continue;
    }

    const recipients = Array.from({ length: size }, () => ({
      address: Keypair.generate().publicKey,
      amount: 0.001,
    }));

    try {
      const result = await spraay.batchSendSol(sender, recipients);
      console.log(
        `  ✅ ${String(size).padStart(2)} recipients -> ${result.transactionCount} tx(s) [${result.signatures[0].slice(0, 16)}...]`
      );

      // If it took more than 1 transaction, we found the chunking point
      if (result.transactionCount > 1) {
        console.log(
          `\n  📏 SDK chunked at ${size} recipients into ${result.transactionCount} transactions`
        );
        console.log(
          `     (maxSolRecipientsPerTx is set to ${15})`
        );
        break;
      }
    } catch (err) {
      console.log(`  ❌ ${size} recipients failed: ${(err as Error).message}`);
      break;
    }

    // Small delay between tests
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log();
}

// ============================================================================
// Run All Tests
// ============================================================================

async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║    💧 Spraay Solana SDK — Full Test Suite           ║");
  console.log("║    Batch payments on Solana (devnet)                ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  console.log(`Sender: ${sender.publicKey.toBase58()}`);
  const solBal = await spraay.getBalance(sender.publicKey);
  const usdcBal = await spraay.getTokenBalance(sender.publicKey, DEVNET_USDC_MINT);
  console.log(`SOL Balance: ${solBal}`);
  console.log(`USDC Balance: ${usdcBal}`);
  console.log("\n" + "=".repeat(55) + "\n");

  // Test 1: Estimates (no network)
  testEstimates();

  console.log("=".repeat(55) + "\n");

  // Test 2: Batch SOL
  await testBatchSol();

  console.log("=".repeat(55) + "\n");

  // Test 3: Batch USDC
  await testBatchUSDC();

  console.log("=".repeat(55) + "\n");

  // Test 4: Stress test
  await testStressSOL();

  console.log("=".repeat(55));
  console.log("🎉 All tests complete!");
}

main().catch(console.error);
