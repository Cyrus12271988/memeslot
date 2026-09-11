import crypto from "crypto";

export function computeHmacSha256(key: string, message: string): string {
  return crypto.createHmac("sha256", key).update(message).digest("hex");
}

export function generateGameOutcome(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  cursor: number
): number {
  // Adding a cursor ensures every individual random roll on the board 
  // gets a unique deterministic slice from the same HMAC signature.
  const message = `${clientSeed}:${nonce}:${cursor}`;
  const hexHash = computeHmacSha256(serverSeed, message);
  const intVal = parseInt(hexHash.slice(0, 8), 16);
  return intVal / 4294967296;
}

export function hashServerSeed(serverSeed: string): string {
  return crypto.createHash("sha256").update(serverSeed).digest("hex");
}

export function generateRandomServerSeed(): string {
  return crypto.randomBytes(32).toString("hex");
}