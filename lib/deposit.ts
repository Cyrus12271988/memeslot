import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { 
  getAssociatedTokenAddress, 
  createAssociatedTokenAccountInstruction, 
  createTransferCheckedInstruction, 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID 
} from "@solana/spl-token";

const TOKEN_CA = new PublicKey("FhgGyS6mC4ZFd2KG5hJLGbiz7skgBaL7fkg2J79upump");
const HOUSE_WALLET = new PublicKey("9iNGzgH4GYyrncTmRDdKJ5wcjJnrqtbiiMAJxdJxx2W2");
const TOKEN_DECIMALS = 6; // Pump.fun tokens default to 6 decimals

export async function executeTokenDeposit(
  connection: Connection,
  wallet: { publicKey: PublicKey; sendTransaction: (tx: Transaction, conn: Connection) => Promise<string> },
  uiAmount: number
) {
  if (!wallet.publicKey) throw new Error("Wallet not connected");

  const userPublicKey = wallet.publicKey;

  // 1. Derive Associated Token Addresses for User and House
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

  // 2. Check if user's ATA exists on-chain; prepend creation instruction if missing
  const userAtaInfo = await connection.getAccountInfo(userATA);
  if (!userAtaInfo) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        userPublicKey, // Payer of rent/initialization fee
        userATA,       // ATA to create
        userPublicKey, // Owner of the ATA
        TOKEN_CA,      // Mint
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }

  // 3. Ensure house ATA exists on-chain (safety check)
  const houseAtaInfo = await connection.getAccountInfo(houseATA);
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

  // 4. Calculate raw token amount accounting for decimals
  const rawAmount = Math.round(uiAmount * Math.pow(10, TOKEN_DECIMALS));

  // 5. Add strict transferChecked instruction
  transaction.add(
    createTransferCheckedInstruction(
      userATA,
      TOKEN_CA,
      houseATA,
      userPublicKey,
      rawAmount,
      TOKEN_DECIMALS,
      [],
      TOKEN_PROGRAM_ID
    )
  );

  // 6. Fetch latest blockhash and configure transaction properties
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = userPublicKey;

  // 7. Prompt user wallet to sign and broadcast transaction
  const signature = await wallet.sendTransaction(transaction, connection);
  
  await connection.confirmTransaction({
    signature,
    blockhash,
    lastValidBlockHeight
  }, "confirmed");

  // 8. Submit signature to your backend route for database crediting
  const response = await fetch("/api/deposit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      walletAddress: userPublicKey.toBase58(),
      signature: signature
    })
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || "Failed to process deposit on backend");
  }

  return result;
}