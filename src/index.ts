import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  Keypair,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getMint,
} from "@solana/spl-token";

// ============================================================================
// Types
// ============================================================================

export interface Recipient {
  /** Recipient wallet address (base58 string or PublicKey) */
  address: string | PublicKey;
  /** Amount to send (in human-readable units, e.g. 10.5 for 10.5 USDC) */
  amount: number;
}

export interface BatchTransferResult {
  /** Array of transaction signatures */
  signatures: string[];
  /** Total number of recipients processed */
  totalRecipients: number;
  /** Total amount sent (human-readable) */
  totalAmount: number;
  /** Number of transactions used */
  transactionCount: number;
  /** Fee collected by Spraay (human-readable) */
  spraayFee: number;
}

export interface SpraayConfig {
  /** Solana RPC endpoint URL */
  rpcUrl: string;
  /** Fee percentage (default: 0.3%) */
  feePercent?: number;
  /** Fee treasury wallet address */
  feeTreasury?: string;
  /** Max recipients per transaction for SOL transfers */
  maxSolRecipientsPerTx?: number;
  /** Max recipients per transaction for SPL transfers (new ATAs) */
  maxSplNewRecipientsPerTx?: number;
  /** Max recipients per transaction for SPL transfers (existing ATAs) */
  maxSplExistingRecipientsPerTx?: number;
  /** Commitment level */
  commitment?: "processed" | "confirmed" | "finalized";
  /** Delay between transactions in ms (to avoid rate limiting) */
  txDelayMs?: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: Required<SpraayConfig> = {
  rpcUrl: "https://api.mainnet-beta.solana.com",
  feePercent: 0.3,
  feeTreasury: "bJ37kGB2i121dSCLunANqh3Qt2RRK14WWH2HGHRTJ4T", // Spraay treasury
  maxSolRecipientsPerTx: 15,
  maxSplNewRecipientsPerTx: 7,
  maxSplExistingRecipientsPerTx: 15,
  commitment: "confirmed",
  txDelayMs: 200,
};

// Well-known SPL token mints on Solana mainnet
export const KNOWN_TOKENS = {
  USDC: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  USDT: new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),
  WSOL: new PublicKey("So11111111111111111111111111111111111111112"),
} as const;

// ============================================================================
// Spraay Solana SDK
// ============================================================================

export class SpraySolana {
  private connection: Connection;
  private config: Required<SpraayConfig>;
  private feeTreasury: PublicKey;

  constructor(config: Partial<SpraayConfig> & { rpcUrl: string }) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.connection = new Connection(this.config.rpcUrl, this.config.commitment);
    this.feeTreasury = new PublicKey(this.config.feeTreasury);
  }

  // ==========================================================================
  // Batch Send SOL
  // ==========================================================================

  /**
   * Send SOL to multiple recipients in optimized batched transactions.
   *
   * @param sender - The sender's Keypair (must have sufficient SOL)
   * @param recipients - Array of { address, amount } where amount is in SOL
   * @returns BatchTransferResult with signatures and summary
   *
   * @example
   * ```ts
   * const result = await spraay.batchSendSol(senderKeypair, [
   *   { address: "Abc...xyz", amount: 0.5 },
   *   { address: "Def...uvw", amount: 1.0 },
   *   { address: "Ghi...rst", amount: 0.25 },
   * ]);
   * console.log(`Sent in ${result.transactionCount} transactions`);
   * ```
   */
  async batchSendSol(
    sender: Keypair,
    recipients: Recipient[]
  ): Promise<BatchTransferResult> {
    if (recipients.length === 0) throw new Error("No recipients provided");

    const totalAmount = recipients.reduce((sum, r) => sum + r.amount, 0);
    const feeAmount = totalAmount * (this.config.feePercent / 100);

    // Build all transfer instructions
    const instructions: TransactionInstruction[] = [];

    for (const recipient of recipients) {
      const recipientPubkey =
        typeof recipient.address === "string"
          ? new PublicKey(recipient.address)
          : recipient.address;

      const lamports = Math.floor(recipient.amount * LAMPORTS_PER_SOL);

      instructions.push(
        SystemProgram.transfer({
          fromPubkey: sender.publicKey,
          toPubkey: recipientPubkey,
          lamports,
        })
      );
    }

    // Add fee transfer to Spraay treasury
    if (feeAmount > 0) {
      const feeLamports = Math.floor(feeAmount * LAMPORTS_PER_SOL);
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: sender.publicKey,
          toPubkey: this.feeTreasury,
          lamports: feeLamports,
        })
      );
    }

    // Chunk into transactions respecting size limits
    const chunks = this.chunkArray(
      instructions,
      this.config.maxSolRecipientsPerTx
    );

    const signatures: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const tx = new Transaction();
      for (const ix of chunks[i]) {
        tx.add(ix);
      }

      const sig = await this.sendTransaction(tx, sender);
      signatures.push(sig);

      // Stagger requests to avoid overwhelming validators
      if (i < chunks.length - 1) {
        await this.delay(this.config.txDelayMs);
      }
    }

    return {
      signatures,
      totalRecipients: recipients.length,
      totalAmount,
      transactionCount: signatures.length,
      spraayFee: feeAmount,
    };
  }

  // ==========================================================================
  // Batch Send SPL Token (e.g. USDC)
  // ==========================================================================

  /**
   * Send SPL tokens to multiple recipients in optimized batched transactions.
   * Automatically creates Associated Token Accounts for new recipients.
   *
   * @param sender - The sender's Keypair
   * @param mint - Token mint address (use KNOWN_TOKENS.USDC for USDC)
   * @param recipients - Array of { address, amount } where amount is in token units
   * @returns BatchTransferResult with signatures and summary
   *
   * @example
   * ```ts
   * const result = await spraay.batchSendToken(senderKeypair, KNOWN_TOKENS.USDC, [
   *   { address: "Abc...xyz", amount: 50 },    // 50 USDC
   *   { address: "Def...uvw", amount: 100 },   // 100 USDC
   *   { address: "Ghi...rst", amount: 25.50 }, // 25.50 USDC
   * ]);
   * ```
   */
  async batchSendToken(
    sender: Keypair,
    mint: PublicKey,
    recipients: Recipient[]
  ): Promise<BatchTransferResult> {
    if (recipients.length === 0) throw new Error("No recipients provided");

    // Get mint info for decimals
    const mintInfo = await getMint(this.connection, mint);
    const decimals = mintInfo.decimals;
    const multiplier = Math.pow(10, decimals);

    const totalAmount = recipients.reduce((sum, r) => sum + r.amount, 0);
    const feeAmount = totalAmount * (this.config.feePercent / 100);

    // Get sender's ATA
    const senderAta = await getAssociatedTokenAddress(mint, sender.publicKey);

    // Check which recipients need ATA creation
    const recipientData = await this.resolveRecipientATAs(
      mint,
      sender.publicKey,
      recipients
    );

    // Separate into batches: those needing ATA creation vs existing
    const needsAta = recipientData.filter((r) => r.needsCreate);
    const hasAta = recipientData.filter((r) => !r.needsCreate);

    const allInstructions: TransactionInstruction[] = [];

    // Build instructions for recipients needing new ATAs
    for (const r of needsAta) {
      // Create ATA instruction
      allInstructions.push(
        createAssociatedTokenAccountInstruction(
          sender.publicKey, // payer
          r.ata, // ATA address
          r.wallet, // owner
          mint // mint
        )
      );
      // Transfer instruction
      const amount = BigInt(Math.floor(r.amount * multiplier));
      allInstructions.push(
        createTransferInstruction(
          senderAta, // source
          r.ata, // destination
          sender.publicKey, // authority
          amount // amount in base units
        )
      );
    }

    // Build instructions for recipients with existing ATAs
    for (const r of hasAta) {
      const amount = BigInt(Math.floor(r.amount * multiplier));
      allInstructions.push(
        createTransferInstruction(
          senderAta,
          r.ata,
          sender.publicKey,
          amount
        )
      );
    }

    // Add fee transfer to Spraay treasury ATA
    if (feeAmount > 0) {
      const treasuryAta = await getAssociatedTokenAddress(
        mint,
        this.feeTreasury
      );
      const feeBaseUnits = BigInt(Math.floor(feeAmount * multiplier));

      // Check if treasury ATA exists
      try {
        await getAccount(this.connection, treasuryAta);
      } catch {
        // Create treasury ATA if it doesn't exist
        allInstructions.push(
          createAssociatedTokenAccountInstruction(
            sender.publicKey,
            treasuryAta,
            this.feeTreasury,
            mint
          )
        );
      }

      allInstructions.push(
        createTransferInstruction(
          senderAta,
          treasuryAta,
          sender.publicKey,
          feeBaseUnits
        )
      );
    }

    // Smart chunking: new ATAs take 2 instructions each (create + transfer)
    // so we need smaller chunks for those
    const chunks = this.smartChunkInstructions(allInstructions, needsAta.length);

    const signatures: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const tx = new Transaction();
      for (const ix of chunks[i]) {
        tx.add(ix);
      }

      const sig = await this.sendTransaction(tx, sender);
      signatures.push(sig);

      if (i < chunks.length - 1) {
        await this.delay(this.config.txDelayMs);
      }
    }

    return {
      signatures,
      totalRecipients: recipients.length,
      totalAmount,
      transactionCount: signatures.length,
      spraayFee: feeAmount,
    };
  }

  // ==========================================================================
  // Batch Send USDC (convenience method)
  // ==========================================================================

  /**
   * Convenience method to batch send USDC.
   * Equivalent to batchSendToken with USDC mint.
   */
  async batchSendUSDC(
    sender: Keypair,
    recipients: Recipient[]
  ): Promise<BatchTransferResult> {
    return this.batchSendToken(sender, KNOWN_TOKENS.USDC, recipients);
  }

  // ==========================================================================
  // Estimate Gas / Cost
  // ==========================================================================

  /**
   * Estimate the total cost of a batch transfer (transaction fees + rent for new ATAs).
   *
   * @param recipientCount - Number of recipients
   * @param isToken - Whether this is a token transfer (vs SOL)
   * @param newAtaCount - Number of recipients that need new ATAs
   * @returns Estimated cost in SOL
   */
  estimateCost(
    recipientCount: number,
    isToken: boolean = false,
    newAtaCount: number = 0
  ): {
    transactionFees: number;
    rentCost: number;
    totalCostSol: number;
    transactionCount: number;
  } {
    const maxPerTx = isToken
      ? newAtaCount > 0
        ? this.config.maxSplNewRecipientsPerTx
        : this.config.maxSplExistingRecipientsPerTx
      : this.config.maxSolRecipientsPerTx;

    const txCount = Math.ceil(recipientCount / maxPerTx);
    const baseFeePerTx = 0.000005; // ~5000 lamports
    const rentPerAta = 0.00203928; // ~rent exempt minimum for token account

    const transactionFees = txCount * baseFeePerTx;
    const rentCost = newAtaCount * rentPerAta;

    return {
      transactionFees,
      rentCost,
      totalCostSol: transactionFees + rentCost,
      transactionCount: txCount,
    };
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Get the SOL balance of a wallet.
   */
  async getBalance(address: string | PublicKey): Promise<number> {
    const pubkey =
      typeof address === "string" ? new PublicKey(address) : address;
    const lamports = await this.connection.getBalance(pubkey);
    return lamports / LAMPORTS_PER_SOL;
  }

  /**
   * Get the token balance of a wallet for a given mint.
   */
  async getTokenBalance(
    address: string | PublicKey,
    mint: PublicKey
  ): Promise<number> {
    const pubkey =
      typeof address === "string" ? new PublicKey(address) : address;
    const ata = await getAssociatedTokenAddress(mint, pubkey);
    try {
      const account = await getAccount(this.connection, ata);
      const mintInfo = await getMint(this.connection, mint);
      return Number(account.amount) / Math.pow(10, mintInfo.decimals);
    } catch {
      return 0;
    }
  }

  /**
   * Get the connection instance (for advanced usage).
   */
  getConnection(): Connection {
    return this.connection;
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private async resolveRecipientATAs(
    mint: PublicKey,
    payer: PublicKey,
    recipients: Recipient[]
  ): Promise<
    Array<{
      wallet: PublicKey;
      ata: PublicKey;
      amount: number;
      needsCreate: boolean;
    }>
  > {
    const results = [];

    for (const recipient of recipients) {
      const wallet =
        typeof recipient.address === "string"
          ? new PublicKey(recipient.address)
          : recipient.address;

      const ata = await getAssociatedTokenAddress(mint, wallet);

      let needsCreate = false;
      try {
        await getAccount(this.connection, ata);
      } catch {
        needsCreate = true;
      }

      results.push({
        wallet,
        ata,
        amount: recipient.amount,
        needsCreate,
      });
    }

    return results;
  }

  private smartChunkInstructions(
    instructions: TransactionInstruction[],
    newAtaCount: number
  ): TransactionInstruction[][] {
    // For new ATAs, each recipient = 2 instructions (create ATA + transfer)
    // For existing ATAs, each recipient = 1 instruction (transfer only)
    // We need to respect the ~1232 byte limit

    // Conservative approach: estimate based on instruction count
    // Each instruction ~= 40-120 bytes depending on type
    const maxInstructionsPerTx = 18; // Conservative limit

    const chunks: TransactionInstruction[][] = [];
    let currentChunk: TransactionInstruction[] = [];

    for (const ix of instructions) {
      currentChunk.push(ix);

      if (currentChunk.length >= maxInstructionsPerTx) {
        chunks.push(currentChunk);
        currentChunk = [];
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  private async sendTransaction(
    transaction: Transaction,
    signer: Keypair
  ): Promise<string> {
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash(this.config.commitment);

    transaction.recentBlockhash = blockhash;
    transaction.feePayer = signer.publicKey;
    transaction.lastValidBlockHeight = lastValidBlockHeight;

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [signer],
      {
        commitment: this.config.commitment,
        maxRetries: 3,
      }
    );

    return signature;
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Export everything
// ============================================================================

export default SpraySolana;
