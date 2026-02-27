"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpraySolana = exports.KNOWN_TOKENS = void 0;
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
// ============================================================================
// Constants
// ============================================================================
const DEFAULT_CONFIG = {
    rpcUrl: "https://api.mainnet-beta.solana.com",
    feePercent: 0.3,
    feeTreasury: "SpRaaYzKRd2TSgCvMwD7KK5HCghAf6FEkFTdAeAoTjr", // TODO: Replace with actual Spraay treasury
    maxSolRecipientsPerTx: 15,
    maxSplNewRecipientsPerTx: 7,
    maxSplExistingRecipientsPerTx: 15,
    commitment: "confirmed",
    txDelayMs: 200,
};
// Well-known SPL token mints on Solana mainnet
exports.KNOWN_TOKENS = {
    USDC: new web3_js_1.PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
    USDT: new web3_js_1.PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),
    WSOL: new web3_js_1.PublicKey("So11111111111111111111111111111111111111112"),
};
// ============================================================================
// Spraay Solana SDK
// ============================================================================
class SpraySolana {
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.connection = new web3_js_1.Connection(this.config.rpcUrl, this.config.commitment);
        this.feeTreasury = new web3_js_1.PublicKey(this.config.feeTreasury);
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
    async batchSendSol(sender, recipients) {
        if (recipients.length === 0)
            throw new Error("No recipients provided");
        const totalAmount = recipients.reduce((sum, r) => sum + r.amount, 0);
        const feeAmount = totalAmount * (this.config.feePercent / 100);
        // Build all transfer instructions
        const instructions = [];
        for (const recipient of recipients) {
            const recipientPubkey = typeof recipient.address === "string"
                ? new web3_js_1.PublicKey(recipient.address)
                : recipient.address;
            const lamports = Math.floor(recipient.amount * web3_js_1.LAMPORTS_PER_SOL);
            instructions.push(web3_js_1.SystemProgram.transfer({
                fromPubkey: sender.publicKey,
                toPubkey: recipientPubkey,
                lamports,
            }));
        }
        // Add fee transfer to Spraay treasury
        if (feeAmount > 0) {
            const feeLamports = Math.floor(feeAmount * web3_js_1.LAMPORTS_PER_SOL);
            instructions.push(web3_js_1.SystemProgram.transfer({
                fromPubkey: sender.publicKey,
                toPubkey: this.feeTreasury,
                lamports: feeLamports,
            }));
        }
        // Chunk into transactions respecting size limits
        const chunks = this.chunkArray(instructions, this.config.maxSolRecipientsPerTx);
        const signatures = [];
        for (let i = 0; i < chunks.length; i++) {
            const tx = new web3_js_1.Transaction();
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
    async batchSendToken(sender, mint, recipients) {
        if (recipients.length === 0)
            throw new Error("No recipients provided");
        // Get mint info for decimals
        const mintInfo = await (0, spl_token_1.getMint)(this.connection, mint);
        const decimals = mintInfo.decimals;
        const multiplier = Math.pow(10, decimals);
        const totalAmount = recipients.reduce((sum, r) => sum + r.amount, 0);
        const feeAmount = totalAmount * (this.config.feePercent / 100);
        // Get sender's ATA
        const senderAta = await (0, spl_token_1.getAssociatedTokenAddress)(mint, sender.publicKey);
        // Check which recipients need ATA creation
        const recipientData = await this.resolveRecipientATAs(mint, sender.publicKey, recipients);
        // Separate into batches: those needing ATA creation vs existing
        const needsAta = recipientData.filter((r) => r.needsCreate);
        const hasAta = recipientData.filter((r) => !r.needsCreate);
        const allInstructions = [];
        // Build instructions for recipients needing new ATAs
        for (const r of needsAta) {
            // Create ATA instruction
            allInstructions.push((0, spl_token_1.createAssociatedTokenAccountInstruction)(sender.publicKey, // payer
            r.ata, // ATA address
            r.wallet, // owner
            mint // mint
            ));
            // Transfer instruction
            const amount = BigInt(Math.floor(r.amount * multiplier));
            allInstructions.push((0, spl_token_1.createTransferInstruction)(senderAta, // source
            r.ata, // destination
            sender.publicKey, // authority
            amount // amount in base units
            ));
        }
        // Build instructions for recipients with existing ATAs
        for (const r of hasAta) {
            const amount = BigInt(Math.floor(r.amount * multiplier));
            allInstructions.push((0, spl_token_1.createTransferInstruction)(senderAta, r.ata, sender.publicKey, amount));
        }
        // Add fee transfer to Spraay treasury ATA
        if (feeAmount > 0) {
            const treasuryAta = await (0, spl_token_1.getAssociatedTokenAddress)(mint, this.feeTreasury);
            const feeBaseUnits = BigInt(Math.floor(feeAmount * multiplier));
            // Check if treasury ATA exists
            try {
                await (0, spl_token_1.getAccount)(this.connection, treasuryAta);
            }
            catch {
                // Create treasury ATA if it doesn't exist
                allInstructions.push((0, spl_token_1.createAssociatedTokenAccountInstruction)(sender.publicKey, treasuryAta, this.feeTreasury, mint));
            }
            allInstructions.push((0, spl_token_1.createTransferInstruction)(senderAta, treasuryAta, sender.publicKey, feeBaseUnits));
        }
        // Smart chunking: new ATAs take 2 instructions each (create + transfer)
        // so we need smaller chunks for those
        const chunks = this.smartChunkInstructions(allInstructions, needsAta.length);
        const signatures = [];
        for (let i = 0; i < chunks.length; i++) {
            const tx = new web3_js_1.Transaction();
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
    async batchSendUSDC(sender, recipients) {
        return this.batchSendToken(sender, exports.KNOWN_TOKENS.USDC, recipients);
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
    estimateCost(recipientCount, isToken = false, newAtaCount = 0) {
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
    async getBalance(address) {
        const pubkey = typeof address === "string" ? new web3_js_1.PublicKey(address) : address;
        const lamports = await this.connection.getBalance(pubkey);
        return lamports / web3_js_1.LAMPORTS_PER_SOL;
    }
    /**
     * Get the token balance of a wallet for a given mint.
     */
    async getTokenBalance(address, mint) {
        const pubkey = typeof address === "string" ? new web3_js_1.PublicKey(address) : address;
        const ata = await (0, spl_token_1.getAssociatedTokenAddress)(mint, pubkey);
        try {
            const account = await (0, spl_token_1.getAccount)(this.connection, ata);
            const mintInfo = await (0, spl_token_1.getMint)(this.connection, mint);
            return Number(account.amount) / Math.pow(10, mintInfo.decimals);
        }
        catch {
            return 0;
        }
    }
    /**
     * Get the connection instance (for advanced usage).
     */
    getConnection() {
        return this.connection;
    }
    // ==========================================================================
    // Private Helpers
    // ==========================================================================
    async resolveRecipientATAs(mint, payer, recipients) {
        const results = [];
        for (const recipient of recipients) {
            const wallet = typeof recipient.address === "string"
                ? new web3_js_1.PublicKey(recipient.address)
                : recipient.address;
            const ata = await (0, spl_token_1.getAssociatedTokenAddress)(mint, wallet);
            let needsCreate = false;
            try {
                await (0, spl_token_1.getAccount)(this.connection, ata);
            }
            catch {
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
    smartChunkInstructions(instructions, newAtaCount) {
        // For new ATAs, each recipient = 2 instructions (create ATA + transfer)
        // For existing ATAs, each recipient = 1 instruction (transfer only)
        // We need to respect the ~1232 byte limit
        // Conservative approach: estimate based on instruction count
        // Each instruction ~= 40-120 bytes depending on type
        const maxInstructionsPerTx = 18; // Conservative limit
        const chunks = [];
        let currentChunk = [];
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
    async sendTransaction(transaction, signer) {
        const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash(this.config.commitment);
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = signer.publicKey;
        transaction.lastValidBlockHeight = lastValidBlockHeight;
        const signature = await (0, web3_js_1.sendAndConfirmTransaction)(this.connection, transaction, [signer], {
            commitment: this.config.commitment,
            maxRetries: 3,
        });
        return signature;
    }
    chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }
    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
exports.SpraySolana = SpraySolana;
// ============================================================================
// Export everything
// ============================================================================
exports.default = SpraySolana;
//# sourceMappingURL=index.js.map