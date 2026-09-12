import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getMint,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const TOKEN_CA = new PublicKey(
  "FhgGyS6mC4ZFd2KG5hJLGbiz7skgBaL7fkg2J79upump"
);

const HOUSE_WALLET = new PublicKey(
  "9iNGzgH4GYyrncTmRDdKJ5wcjJnrqtbiiMAJxdJxx2W2"
);

export async function executeTokenDeposit(
  connection: Connection,
  wallet: {
    publicKey: PublicKey;
    sendTransaction: (
      tx: Transaction,
      conn: Connection
    ) => Promise<string>;
  },
  uiAmount: number
) {
  if (!wallet.publicKey) {
    throw new Error("Wallet not connected");
  }

  if (!Number.isFinite(uiAmount) || uiAmount <= 0) {
    throw new Error("Invalid deposit amount");
  }

  const userPublicKey = wallet.publicKey;

  // ============================================================
  // 1. READ THE ACTUAL MINT
  // ============================================================

  const mintInfo = await getMint(
    connection,
    TOKEN_CA,
    "confirmed",
    TOKEN_PROGRAM_ID
  );

  const decimals = mintInfo.decimals;

  // ============================================================
  // 2. DERIVE USER + HOUSE ATAs
  // ============================================================

  const userATA = await getAssociatedTokenAddress(
    TOKEN_CA,
    userPublicKey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const houseATA = await getAssociatedTokenAddress(
    TOKEN_CA,
    HOUSE_WALLET,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const transaction = new Transaction();

  // ============================================================
  // 3. USER ATA
  // ============================================================

  const userAtaInfo = await connection.getAccountInfo(
    userATA,
    "confirmed"
  );

  if (!userAtaInfo) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        userPublicKey,
        userATA,
        userPublicKey,
        TOKEN_CA,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }

  // ============================================================
  // 4. HOUSE ATA
  // ============================================================

  const houseAtaInfo = await connection.getAccountInfo(
    houseATA,
    "confirmed"
  );

  if (!houseAtaInfo) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        userPublicKey,
        houseATA,
        HOUSE_WALLET,
        TOKEN_CA,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }

  // ============================================================
  // 5. CONVERT HUMAN AMOUNT -> RAW TOKEN AMOUNT
  // ============================================================

  const multiplier = 10 ** decimals;

  const rawAmount = Math.round(uiAmount * multiplier);

  if (!Number.isSafeInteger(rawAmount) || rawAmount <= 0) {
    throw new Error("Deposit amount is too large or invalid");
  }

  // ============================================================
  // 6. STRICT SPL TOKEN TRANSFER
  // ============================================================

  transaction.add(
    createTransferCheckedInstruction(
      userATA,
      TOKEN_CA,
      houseATA,
      userPublicKey,
      rawAmount,
      decimals,
      [],
      TOKEN_PROGRAM_ID
    )
  );

  // ============================================================
  // 7. BLOCKHASH
  // ============================================================

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  transaction.recentBlockhash = blockhash;
  transaction.feePayer = userPublicKey;

  // ============================================================
  // 8. WALLET SIGN + SEND
  // ============================================================

  const signature = await wallet.sendTransaction(
    transaction,
    connection
  );

  // ============================================================
  // 9. WAIT FOR CONFIRMATION
  // ============================================================

  const confirmation = await connection.confirmTransaction(
    {
      signature,
      blockhash,
      lastValidBlockHeight,
    },
    "confirmed"
  );

  if (confirmation.value.err) {
    throw new Error(
      `Deposit transaction failed: ${JSON.stringify(
        confirmation.value.err
      )}`
    );
  }

  // ============================================================
  // 10. BACKEND VERIFICATION
  // ============================================================

  const response = await fetch("/api/deposit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      walletAddress: userPublicKey.toBase58(),
      signature,
      mint: TOKEN_CA.toBase58(),
      destination: HOUSE_WALLET.toBase58(),
      amount: uiAmount,
    }),
  });

  let result: any;

  try {
    result = await response.json();
  } catch {
    throw new Error(
      `Deposit backend returned invalid JSON (${response.status})`
    );
  }

  if (!response.ok) {
    throw new Error(
      result?.error || "Failed to process deposit on backend"
    );
  }

  return {
    ...result,
    signature,
  };
}