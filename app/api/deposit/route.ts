import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";
import { createClient } from "@supabase/supabase-js";
import { acquireLock, releaseLock } from "@/utils/lock";

const HOUSE_WALLET = new PublicKey("9iNGzgH4GYyrncTmRDdKJ5wcjJnrqtbiiMAJxdJxx2W2");
const TOKEN_CA = new PublicKey("FhgGyS6mC4ZFd2KG5hJLGbiz7skgBaL7fkg2J79upump");
const TOKEN_DECIMALS = 6;

const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const connection = new Connection(SOLANA_RPC, "finalized");

// INITIALIZE SUPABASE CLIENT (Secure server-side service role)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 1. ATOMIC SUPABASE HELPER (Prevents Race Conditions via DB RPC)
async function updateDatabaseBalanceAndRecordDeposit(
  walletAddress: string, 
  signature: string, 
  amount: number
): Promise<number> {
  // Step 1: Insert into deposits history using your exact table column 'signature'
  const { error: insertError } = await supabase.from("deposits").insert({
    wallet_address: walletAddress,
    currency: "SPL",
    amount: amount,
    signature: signature, // Matches your column name visible in Supabase
    status: "confirmed"
  });

  if (insertError) {
    if (insertError.code === "23505") {
      throw new Error("TRANSACTION_ALREADY_PROCESSED");
    }
    throw new Error(`Database insert error: ${insertError.message}`);
  }

  // Step 2: Atomically increment user balance
  const { data: newBalance, error: rpcError } = await supabase.rpc('increment_balance', {
    row_wallet: walletAddress,
    inc_amount: amount
  });

  if (rpcError) {
    throw new Error(`Failed to update user balance atomically: ${rpcError.message}`);
  }

  return Number(newBalance);
}

export async function POST(request: Request) {
  let walletAddress: string | null = null;

  try {
    const body = await request.json();
    walletAddress = body.walletAddress;
    const { signature } = body;

    if (!walletAddress || !signature || typeof signature !== "string") {
      return NextResponse.json({ error: "Invalid deposit parameters" }, { status: 400 });
    }

    // Acquire concurrency lock per user to prevent rapid-fire requests
    const acquired = await acquireLock(walletAddress);
    if (!acquired) {
      return NextResponse.json({ error: "Too many concurrent requests. Please try again." }, { status: 429 });
    }

    try {
      // 2. FETCH TRANSACTION FROM SOLANA (Using 'finalized' commitment for financial safety)
      const tx = await connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "finalized",
      });

      if (!tx || !tx.meta || tx.meta.err) {
        return NextResponse.json({ error: "Transaction not found, failed on-chain, or not yet finalized" }, { status: 400 });
      }

      const houseATA = await getAssociatedTokenAddress(TOKEN_CA, HOUSE_WALLET);
      const houseATAPubkeyStr = houseATA.toBase58();

      let verifiedAmount = 0;

      // Recursive / structural instruction parser for top-level and inner instructions
      const processInstructions = (instructionsList: any[]) => {
        for (const inst of instructionsList) {
          if (!inst) continue;
          const programIdStr = inst.programId ? inst.programId.toBase58() : "";
          if (programIdStr === TOKEN_PROGRAM_ID.toBase58() && "parsed" in inst && inst.parsed) {
            const info = inst.parsed.info;
            const type = inst.parsed.type;

            if (type === "transferChecked" || type === "transfer") {
              const isCorrectMint = info.mint ? info.mint === TOKEN_CA.toBase58() : true;
              const isDestinationHouse = info.destination === houseATAPubkeyStr;
              const isSenderUser = info.authority ? info.authority === walletAddress : true;
              const rawAmount = Number(info.tokenAmount?.amount || info.amount || 0);

              if (isCorrectMint && isDestinationHouse && isSenderUser && rawAmount > 0) {
                verifiedAmount += rawAmount / Math.pow(10, TOKEN_DECIMALS);
              }
            }
          }
        }
      };

      if (tx.transaction?.message?.instructions) {
        processInstructions(tx.transaction.message.instructions);
      }
      if (tx.meta.innerInstructions) {
        for (const inner of tx.meta.innerInstructions) {
          if (inner?.instructions) {
            processInstructions(inner.instructions);
          }
        }
      }

      if (verifiedAmount <= 0) {
        return NextResponse.json({ 
          error: "No valid deposit to the House Wallet found in this transaction" 
        }, { status: 400 });
      }

      // 3. RECORD DEPOSIT & ATOMICALLY UPDATE BALANCE IN SUPABASE
      let newBalance: number;
      try {
        newBalance = await updateDatabaseBalanceAndRecordDeposit(walletAddress, signature, verifiedAmount);
      } catch (dbError: any) {
        if (dbError.message === "TRANSACTION_ALREADY_PROCESSED") {
          return NextResponse.json({ error: "Transaction signature already processed" }, { status: 400 });
        }
        throw dbError;
      }

      return NextResponse.json({
        success: true,
        message: "Deposit verified and credited successfully",
        depositedAmount: verifiedAmount,
        newBalance,
      });

    } finally {
      if (walletAddress) releaseLock(walletAddress);
    }

  } catch (error: any) {
    console.error("Deposit route error:", error);
    if (walletAddress) releaseLock(walletAddress);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}