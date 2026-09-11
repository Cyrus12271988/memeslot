import { NextResponse } from "next/server";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { 
  getAssociatedTokenAddress, 
  createAssociatedTokenAccountInstruction, 
  createTransferCheckedInstruction 
} from "@solana/spl-token";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { acquireLock, releaseLock } from "@/utils/lock";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const TARGET_TOKEN_CA = new PublicKey("FhgGyS6mC4ZFd2KG5hJLGbiz7skgBaL7fkg2J79upump");
const TOKEN_DECIMALS = 6;

const SOLANA_RPC = process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const connection = new Connection(SOLANA_RPC, "finalized"); // 'finalized' commitment for money movement

const getHouseKeypair = (): Keypair => {
  const secretKeyString = process.env.HOUSE_PRIVATE_KEY;
  if (!secretKeyString) throw new Error("HOUSE_PRIVATE_KEY not set in environment variables");

  try {
    if (secretKeyString.startsWith("[")) {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secretKeyString)));
    }
    return Keypair.fromSecretKey(bs58.decode(secretKeyString));
  } catch (err) {
    throw new Error("Invalid HOUSE_PRIVATE_KEY format. Must be JSON array or Base58 string.");
  }
};

export async function POST(req: Request) {
  let walletAddress: string | null = null;

  try {
    const body = await req.json();
    walletAddress = body.walletAddress ? String(body.walletAddress).trim() : null;
    const amount = Number(body.amount);
    const { signature, timestamp, tokenCa } = body;

    // 1. INPUT PARAMS VALIDATION
    if (!walletAddress || isNaN(amount) || amount <= 0) {
      return NextResponse.json({ success: false, error: "Missing or invalid withdrawal parameters" }, { status: 400 });
    }

    if (!signature || !timestamp) {
      return NextResponse.json({ success: false, error: "Missing authentication signature or timestamp" }, { status: 400 });
    }

    if (tokenCa && tokenCa !== TARGET_TOKEN_CA.toBase58()) {
      return NextResponse.json({ success: false, error: "Token CA mismatch" }, { status: 400 });
    }

    // 2. REPLAY & TIMEOUT PROTECTION (2 Minute Expiration Window)
    const now = Date.now();
    if (now - timestamp > 120000 || timestamp > now + 10000) {
      return NextResponse.json({ success: false, error: "Withdrawal request expired or invalid timestamp" }, { status: 400 });
    }

    // 3. CRYPTOGRAPHIC ED25519 SIGNATURE VERIFICATION
    const expectedMessage = `Withdraw ${amount} tokens at timestamp: ${timestamp}`;
    const messageBytes = new TextEncoder().encode(expectedMessage);
    const pubKeyBytes = new PublicKey(walletAddress).toBytes();
    const signatureBytes = bs58.decode(signature);

    const isSignatureValid = nacl.sign.detached.verify(messageBytes, signatureBytes, pubKeyBytes);
    if (!isSignatureValid) {
      return NextResponse.json({ success: false, error: "Authentication failed: Invalid signature" }, { status: 401 });
    }

    // 4. CONCURRENCY LOCKING
    const acquired = await acquireLock(walletAddress);
    if (!acquired) {
      return NextResponse.json({ success: false, error: "Too many concurrent requests. Please try again." }, { status: 429 });
    }

    try {
      // 5. ATOMIC DEDUCTION FIRST (Prevents double-spend races before touching the blockchain)
      const { data: newBalance, error: rpcError } = await supabaseAdmin.rpc('withdraw_balance', {
        row_wallet: walletAddress,
        sub_amount: amount
      });

      if (rpcError) {
        if (rpcError.message.includes("INSUFFICIENT_BALANCE")) {
          return NextResponse.json({ success: false, error: "Insufficient vault balance" }, { status: 400 });
        }
        if (rpcError.message.includes("USER_NOT_FOUND")) {
          return NextResponse.json({ success: false, error: "User account not found" }, { status: 404 });
        }
        throw new Error(rpcError.message);
      }

      const houseKeypair = getHouseKeypair();
      const userPublicKey = new PublicKey(walletAddress);

      const houseATA = await getAssociatedTokenAddress(TARGET_TOKEN_CA, houseKeypair.publicKey);
      const userATA = await getAssociatedTokenAddress(TARGET_TOKEN_CA, userPublicKey);

      const transaction = new Transaction();

      // 6. CHECK IF USER ATA EXISTS (Create if missing)
      const userAtaInfo = await connection.getAccountInfo(userATA);
      if (!userAtaInfo) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            houseKeypair.publicKey, // House pays rent fee
            userATA,
            userPublicKey,
            TARGET_TOKEN_CA
          )
        );
      }

      const rawAmount = Math.floor(amount * Math.pow(10, TOKEN_DECIMALS));

      // 7. ADD TRANSFER INSTRUCTION
      transaction.add(
        createTransferCheckedInstruction(
          houseATA,
          TARGET_TOKEN_CA,
          userATA,
          houseKeypair.publicKey,
          rawAmount,
          TOKEN_DECIMALS
        )
      );

      // 8. SIGN & BROADCAST ON-CHAIN PAYOUT (With rollback safety protection if Solana fails)
      let txSignature: string;
      try {
        txSignature = await connection.sendTransaction(transaction, [houseKeypair]);
        await connection.confirmTransaction(txSignature, "finalized");
      } catch (chainError: any) {
        // CRITICAL SAFETY ROLLBACK: If blockchain transfer fails, refund the user's balance immediately!
        await supabaseAdmin.rpc('increment_balance', {
          row_wallet: walletAddress,
          inc_amount: amount
        });
        throw new Error(`On-chain transfer failed: ${chainError.message}`);
      }

      // 9. LOG WITHDRAWAL HISTORY
      await supabaseAdmin.from("withdrawals").insert({
        wallet_address: walletAddress,
        amount: amount,
        signature: txSignature,
        status: "success"
      });

      return NextResponse.json({
        success: true,
        signature: txSignature,
        newBalance: Number(newBalance),
      });

    } finally {
      if (walletAddress) releaseLock(walletAddress);
    }

  } catch (error: any) {
    console.error("Withdrawal processing error:", error);
    if (walletAddress) releaseLock(walletAddress);
    return NextResponse.json({ success: false, error: error.message || "Internal server error" }, { status: 500 });
  }
}