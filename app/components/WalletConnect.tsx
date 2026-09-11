"use client";

import { useEffect, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export function WalletConnect() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <button className="rounded-xl bg-purple-600/50 px-5 py-2.5 text-sm font-bold opacity-50 cursor-not-allowed">
        Connect Wallet
      </button>
    );
  }

  return (
    <WalletMultiButton className="!bg-purple-600 hover:!bg-purple-500 !rounded-xl !font-bold !py-2.5 !px-5 !h-auto !transition text-sm" />
  );
}