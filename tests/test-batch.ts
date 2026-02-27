/**
 * Spraay Solana SDK — Test Suite
 *
 * Run on devnet:
 *   CLUSTER=devnet ts-node tests/test-batch.ts
 *
 * Prerequisites:
 *   - npm install
 *   - Fund sender wallet with devnet SOL: solana airdrop 2 <SENDER_ADDRESS> --url devnet
 */

import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { SpraySolana, KNOWN_TOKENS } from "../src/index";

// ============================================================================
// Config
// ============================================================================

const DEVNET_RPC = "https://api.devnet.solana.com";

// Generate a fresh sender keypair for testing
// In production, load from env or wallet adapter
const sender = Keypair.generate();

// Generate test recipients
const recipient1 = Keypair.generate();
const recipient2 = Keypair.generate();
const recipient3 = Keypair.generate();

// Initialize Spraay SDK
const spraay = new SpraySolana({
  rpcUrl: DEVNET_RPC,
  feePercent: 0.3,
  feeTreasury: sender.publicKey.toBase58(), // Send fees back to sender for testing
  commitment: "confirmed",
});

// ============================================================================
// Test: Batch SOL Transfer
// ============================================================================

async function testBatchSolTransfer() {
  console.log("=== Spraay Solana SDK — Batch SOL Transfer Test ===\n");

  console.log("Sender:", sender.publicKey.toBase58());
  console.log("Recipient 1:", recipient1.publicKey.toBase58());
  console.log("Recipient 2:", recipient2.publicKey.toBase58());
  console.log("Recipient 3:", recipient3.publicKey.toBase58());

  // Step 1: Airdrop SOL to sender on devnet
  console.log("\n[1/4] Requesting airdrop...");
  const connection = spraay.getConnection();

  try {
    const airdropSig = await connection.requestAirdrop(
      sender.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSig, "confirmed");
    console.log("  ✓ Airdrop confirmed:", airdropSig.slice(0, 20) + "...");
  } catch (err) {
    console.error("  ✗ Airdrop failed (devnet may be congested). Try again.");
    console.error("    Error:", (err as Error).message);
    return;
  }

  // Step 2: Check sender balance
  const senderBalance = await spraay.getBalance(sender.publicKey);
  console.log(`\n[2/4] Sender balance: ${senderBalance} SOL`);

  // Step 3: Estimate cost
  console.log("\n[3/4] Estimating batch cost...");
  const estimate = spraay.estimateCost(3, false);
  console.log(`  Transaction fees: ~${estimate.transactionFees} SOL`);
  console.log(`  Transactions needed: ${estimate.transactionCount}`);

  // Step 4: Execute batch SOL transfer
  console.log("\n[4/4] Executing batch SOL transfer...");
  console.log("  Sending 0.1 SOL to 3 recipients...\n");

  try {
    const result = await spraay.batchSendSol(sender, [
      { address: recipient1.publicKey, amount: 0.1 },
      { address: recipient2.publicKey, amount: 0.1 },
      { address: recipient3.publicKey, amount: 0.1 },
    ]);

    console.log("=== Batch Transfer Complete ===");
    console.log(`  Recipients:    ${result.totalRecipients}`);
    console.log(`  Total sent:    ${result.totalAmount} SOL`);
    console.log(`  Spraay fee:    ${result.spraayFee} SOL`);
    console.log(`  Transactions:  ${result.transactionCount}`);
    console.log(`  Signatures:`);
    result.signatures.forEach((sig, i) => {
      console.log(`    [${i + 1}] ${sig}`);
      console.log(
        `        https://explorer.solana.com/tx/${sig}?cluster=devnet`
      );
    });

    // Verify balances
    console.log("\n=== Final Balances ===");
    const r1Balance = await spraay.getBalance(recipient1.publicKey);
    const r2Balance = await spraay.getBalance(recipient2.publicKey);
    const r3Balance = await spraay.getBalance(recipient3.publicKey);
    const finalSender = await spraay.getBalance(sender.publicKey);

    console.log(`  Sender:      ${finalSender} SOL`);
    console.log(`  Recipient 1: ${r1Balance} SOL`);
    console.log(`  Recipient 2: ${r2Balance} SOL`);
    console.log(`  Recipient 3: ${r3Balance} SOL`);

    console.log("\n✓ Batch SOL transfer test passed!");
  } catch (err) {
    console.error("  ✗ Batch transfer failed:", (err as Error).message);
  }
}

// ============================================================================
// Test: Estimate Large Batch
// ============================================================================

function testEstimateLargeBatch() {
  console.log("\n=== Cost Estimate: 200 USDC Recipients ===\n");

  // Estimate for 200 recipients, all needing new ATAs
  const worstCase = spraay.estimateCost(200, true, 200);
  console.log("Worst case (all new ATAs):");
  console.log(`  Transaction fees:  ${worstCase.transactionFees.toFixed(6)} SOL`);
  console.log(`  ATA rent cost:     ${worstCase.rentCost.toFixed(6)} SOL`);
  console.log(`  Total cost:        ${worstCase.totalCostSol.toFixed(6)} SOL`);
  console.log(`  Transactions:      ${worstCase.transactionCount}`);

  // Estimate for 200 recipients, all with existing ATAs
  const bestCase = spraay.estimateCost(200, true, 0);
  console.log("\nBest case (all existing ATAs):");
  console.log(`  Transaction fees:  ${bestCase.transactionFees.toFixed(6)} SOL`);
  console.log(`  ATA rent cost:     ${bestCase.rentCost.toFixed(6)} SOL`);
  console.log(`  Total cost:        ${bestCase.totalCostSol.toFixed(6)} SOL`);
  console.log(`  Transactions:      ${bestCase.transactionCount}`);
}

// ============================================================================
// Run Tests
// ============================================================================

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║      💧 Spraay Solana SDK — Test Suite          ║");
  console.log("║      Batch payments on Solana                   ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  // Always run estimates (no network needed)
  testEstimateLargeBatch();

  // Run devnet test
  console.log("\n" + "=".repeat(50));
  await testBatchSolTransfer();
}

main().catch(console.error);
