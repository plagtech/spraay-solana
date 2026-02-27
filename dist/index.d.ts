import { Connection, PublicKey, Keypair } from "@solana/web3.js";
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
export declare const KNOWN_TOKENS: {
    readonly USDC: PublicKey;
    readonly USDT: PublicKey;
    readonly WSOL: PublicKey;
};
export declare class SpraySolana {
    private connection;
    private config;
    private feeTreasury;
    constructor(config: Partial<SpraayConfig> & {
        rpcUrl: string;
    });
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
    batchSendSol(sender: Keypair, recipients: Recipient[]): Promise<BatchTransferResult>;
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
    batchSendToken(sender: Keypair, mint: PublicKey, recipients: Recipient[]): Promise<BatchTransferResult>;
    /**
     * Convenience method to batch send USDC.
     * Equivalent to batchSendToken with USDC mint.
     */
    batchSendUSDC(sender: Keypair, recipients: Recipient[]): Promise<BatchTransferResult>;
    /**
     * Estimate the total cost of a batch transfer (transaction fees + rent for new ATAs).
     *
     * @param recipientCount - Number of recipients
     * @param isToken - Whether this is a token transfer (vs SOL)
     * @param newAtaCount - Number of recipients that need new ATAs
     * @returns Estimated cost in SOL
     */
    estimateCost(recipientCount: number, isToken?: boolean, newAtaCount?: number): {
        transactionFees: number;
        rentCost: number;
        totalCostSol: number;
        transactionCount: number;
    };
    /**
     * Get the SOL balance of a wallet.
     */
    getBalance(address: string | PublicKey): Promise<number>;
    /**
     * Get the token balance of a wallet for a given mint.
     */
    getTokenBalance(address: string | PublicKey, mint: PublicKey): Promise<number>;
    /**
     * Get the connection instance (for advanced usage).
     */
    getConnection(): Connection;
    private resolveRecipientATAs;
    private smartChunkInstructions;
    private sendTransaction;
    private chunkArray;
    private delay;
}
export default SpraySolana;
//# sourceMappingURL=index.d.ts.map