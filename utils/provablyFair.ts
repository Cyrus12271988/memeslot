// Browser & Next.js compatible Provably Fair hashing utility

async function computeHmacSha256(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: { name: "SHA-256" } },
    false,
    ["sign"]
  );
  const signature = await window.crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    enc.encode(message)
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function generateGameOutcome(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): Promise<number> {
  const message = `${clientSeed}:${nonce}`;
  const hexHash = await computeHmacSha256(serverSeed, message);
  const intVal = parseInt(hexHash.slice(0, 8), 16);
  return intVal / 4294967296;
}

export async function hashServerSeed(serverSeed: string): Promise<string> {
  const enc = new TextEncoder();
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", enc.encode(serverSeed));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}