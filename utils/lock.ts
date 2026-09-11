// utils/lock.ts
const locks = new Map<string, boolean>();

export async function acquireLock(walletAddress: string, timeoutMs = 5000): Promise<boolean> {
  const start = Date.now();
  while (locks.get(walletAddress)) {
    if (Date.now() - start > timeoutMs) {
      return false; // Timeout waiting for lock
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  locks.set(walletAddress, true);
  return true;
}

export function releaseLock(walletAddress: string): void {
  locks.delete(walletAddress);
}
