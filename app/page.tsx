"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey, LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";
import { 
  getAssociatedTokenAddress, 
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAccount 
} from "@solana/spl-token";
import bs58 from "bs58";
import ProvablyFairChecker from "./components/ProvablyFairChecker";

// TARGET TOKEN CONTRACT ADDRESS
const TARGET_TOKEN_CA = "FhgGyS6mC4ZFd2KG5hJLGbiz7skgBaL7fkg2J79upump";

// HOUSE / TREASURY WALLET DESTINATION FOR DEPOSITS
const HOUSE_WALLET_ADDRESS = "9iNGzgH4GYyrncTmRDdKJ5wcjJnrqtbiiMAJxdJxx2W2";

/**
 * SSR/Hydration-Safe Wallet Connect Button Component
 */
function WalletConnect() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="inline-flex items-center">
      {!mounted ? (
        <button 
          disabled 
          className="rounded-xl bg-purple-600/50 px-3 py-2 text-xs sm:px-4 sm:text-sm font-bold opacity-50 cursor-not-allowed"
        >
          Connect Wallet
        </button>
      ) : (
        <WalletMultiButton className="!bg-purple-600 hover:!bg-purple-500 !rounded-xl !font-bold !py-2 !px-3 sm:!px-4 !h-auto !transition !text-xs sm:!text-sm" />
      )}
    </div>
  );
}

interface LeaderboardEntry {
  rank: number;
  wallet: string;
  score: number;
}

/**
 * Leaderboard Modal Component
 */
function LeaderboardModal({ onClose }: { onClose: () => void }) {
  const [leaders, setLeaders] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/leaderboard')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setLeaders(data.leaderboard);
        }
      })
      .catch((err) => console.error("Failed to load leaderboard:", err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0f0f17] p-5 sm:p-6 text-white shadow-2xl">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white font-bold text-sm bg-slate-800 w-8 h-8 rounded-full flex items-center justify-center transition"
        >
          ✕
        </button>

        <h3 className="text-xl sm:text-2xl font-black mb-1 text-purple-400">🏆 Top Degen Leaderboard</h3>
        <p className="text-xs text-slate-400 mb-6">Top high-rollers ranked by total earnings this season.</p>

        {loading ? (
          <div className="py-12 text-center text-slate-500 font-mono text-sm">Loading rankings...</div>
        ) : (
          <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
            {leaders.map((entry) => (
              <div 
                key={entry.rank} 
                className={`flex items-center justify-between p-3.5 rounded-xl border ${
                  entry.rank === 1 ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300' :
                  entry.rank === 2 ? 'bg-slate-300/10 border-slate-300/30 text-slate-200' :
                  entry.rank === 3 ? 'bg-amber-600/10 border-amber-600/30 text-amber-400' :
                  'bg-white/5 border-white/5 text-slate-300'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="font-black text-sm w-6">#{entry.rank}</span>
                  <span className="font-mono text-xs">{entry.wallet.slice(0, 4)}...{entry.wallet.slice(-4)}</span>
                </div>
                <span className="font-mono font-bold text-xs sm:text-sm">{entry.score.toLocaleString()} TOKEN</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface HistoryEntry {
  id: string;
  game_name: string;
  bet_amount: number;
  payout: number;
  multiplier: number;
  created_at: string;
}

/**
 * User History Modal Component with Validated Date & Time Parsing
 */
function HistoryModal({ walletAddress, onClose }: { walletAddress: string; onClose: () => void }) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/history?walletAddress=${walletAddress}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setHistory(data.history);
        }
      })
      .catch((err) => console.error("Failed to load user history:", err))
      .finally(() => setLoading(false));
  }, [walletAddress]);

  const formatValidDate = (dateInput: string | number | Date) => {
    if (!dateInput) return "Recent";
    const parsedDate = new Date(dateInput);
    if (isNaN(parsedDate.getTime())) {
      return "Recent";
    }
    return parsedDate.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0f0f17] p-5 sm:p-6 text-white shadow-2xl">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white font-bold text-sm bg-slate-800 w-8 h-8 rounded-full flex items-center justify-center transition"
        >
          ✕
        </button>

        <h3 className="text-xl sm:text-2xl font-black mb-1 text-purple-400">📜 Unified Casino History</h3>
        <p className="text-xs text-slate-400 mb-6">Track your spins across all slots and Meme Fortune roulette.</p>

        {loading ? (
          <div className="py-12 text-center text-slate-500 font-mono text-sm">Loading history...</div>
        ) : history.length === 0 ? (
          <div className="py-12 text-center text-slate-500 font-mono text-sm">No game history found yet. Start playing!</div>
        ) : (
          <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
            {history.map((item) => {
              const isWin = item.payout > 0;
              return (
                <div 
                  key={item.id} 
                  className={`flex items-center justify-between p-3.5 rounded-xl border ${
                    isWin ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-white/5 border-white/5 text-slate-400'
                  }`}
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-bold text-xs sm:text-sm text-white flex items-center gap-1.5">
                      {item.game_name === "Meme Fortune" ? "😂" : "🎰"} {item.game_name || "Casino Spin"}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">{formatValidDate(item.created_at)}</span>
                  </div>
                  <div className="flex items-center gap-4 text-right font-mono text-xs sm:text-sm">
                    <div>
                      <span className="block text-[10px] text-slate-400 uppercase">Bet</span>
                      <span>{item.bet_amount}</span>
                    </div>
                    <div>
                      <span className="block text-[10px] text-slate-400 uppercase">Multiplier</span>
                      <span>{item.multiplier}x</span>
                    </div>
                    <div>
                      <span className="block text-[10px] text-slate-400 uppercase">Payout</span>
                      <span className={isWin ? 'text-emerald-400 font-bold' : 'text-slate-400'}>
                        {item.payout}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const games = [
  { name: "Token Rush", emoji: "🪙", category: "Popular", playable: true, route: "/games/token-rush" },
   { name: "Meme Fortune", emoji: "😂", category: "Popular", playable: true, route: "/games/meme-fortune" },
  { name: "Baccarat", emoji: "🃏", category: "Featured", playable: true, route: "/games/baccarat" },
  { name: "Chess", emoji: "💎", category: "Featured", playable: true, route: "/games/chess" },
   { name: "Moon Mission", emoji: "🚀", category: "New", playable: true, route: "/games/moon-mission" },
  { name: "Whale Hunter", emoji: "🐋", category: "Popular", playable: false, route: "#" },
  { name: "Degen Gold", emoji: "🏆", category: "New", playable: false, route: "#" },
  { name: "Moonshot Jackpot", emoji: "🌕", category: "Jackpot", playable: false, route: "#" },
];

export default function Home() {
  const [category, setCategory] = useState("All");
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [showFairnessModal, setShowFairnessModal] = useState(false);
  const [showLeaderboardModal, setShowLeaderboardModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [loadingTx, setLoadingTx] = useState(false);
  const [copied, setCopied] = useState(false);

  const { connection } = useConnection();
  const { publicKey, connected, sendTransaction, signMessage } = useWallet();

  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [loadingBalances, setLoadingBalances] = useState<boolean>(false);
  const [casinoBalance, setCasinoBalance] = useState<number>(0);

  const categories = ["All", "Featured", "Popular", "New", "Jackpot"];

  const handleCopyCA = () => {
    navigator.clipboard.writeText(TARGET_TOKEN_CA);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fetchWalletBalances = useCallback(async () => {
    if (!publicKey || !connected) {
      setSolBalance(null);
      setTokenBalance(null);
      setCasinoBalance(0);
      return;
    }

    try {
      setLoadingBalances(true);

      const solLamports = await connection.getBalance(publicKey, "confirmed");
      setSolBalance(solLamports / LAMPORTS_PER_SOL);

      const mintPublicKey = new PublicKey(TARGET_TOKEN_CA);
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        publicKey,
        { mint: mintPublicKey }
      );

      if (tokenAccounts.value.length > 0) {
        const rawAmount =
          tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
        setTokenBalance(rawAmount || 0);
      } else {
        setTokenBalance(0);
      }

      const res = await fetch(`/api/balance?walletAddress=${publicKey.toBase58()}`);
      const data = await res.json();
      if (data.success) {
        setCasinoBalance(data.balance);
      }
    } catch (error) {
      console.error("Error fetching wallet or vault balances:", error);
      setSolBalance(0);
      setTokenBalance(0);
    } finally {
      setLoadingBalances(false);
    }
  }, [publicKey, connected, connection]);

  useEffect(() => {
    fetchWalletBalances();
  }, [fetchWalletBalances]);

  const filteredGames =
    category === "All"
      ? games
      : games.filter((game) => game.category === category);

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publicKey) return;

    try {
      setLoadingTx(true);
      const mintPublicKey = new PublicKey(TARGET_TOKEN_CA);
      const housePubkey = new PublicKey(HOUSE_WALLET_ADDRESS);

      const userATA = await getAssociatedTokenAddress(mintPublicKey, publicKey);
      const houseATA = await getAssociatedTokenAddress(mintPublicKey, housePubkey);

      try {
        const accountInfo = await getAccount(connection, userATA);
        if (!accountInfo.mint.equals(mintPublicKey)) {
          throw new Error("Invalid token mint! This account does not match your target token CA.");
        }
      } catch (error: any) {
        if (error?.name === "TokenAccountNotFoundError" || error?.message?.includes("Account does not exist")) {
          throw new Error("You do not have a token account for this token CA yet, or your balance is 0.");
        }
        throw error;
      }

      const transaction = new Transaction();
      const houseAccountInfo = await connection.getAccountInfo(houseATA);
      if (!houseAccountInfo) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            publicKey,
            houseATA,
            housePubkey,
            mintPublicKey
          )
        );
      }

      const decimals = 6;
      const depositNum = Number(amount);
      const transferAmount = Math.floor(depositNum * Math.pow(10, decimals));

      transaction.add(
        createTransferCheckedInstruction(
          userATA,
          mintPublicKey,
          houseATA,
          publicKey,
          transferAmount,
          decimals
        )
      );

      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, "confirmed");

      const res = await fetch("/api/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: publicKey.toBase58(),
          signature,
          amount: depositNum,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to credit backend vault balance");
      }

      setCasinoBalance(data.newBalance);
      alert(`Deposit successful! Credited ${depositNum} tokens to your secure casino vault.`);
      setShowDepositModal(false);
      setAmount("");
      fetchWalletBalances();
    } catch (error: any) {
      if (
        error?.message?.includes("User rejected") || 
        error?.name === "WalletSignTransactionError" ||
        error?.code === 4001 ||
        error?.message?.includes("Cancelled")
      ) {
        return;
      }
      console.error("Deposit failed:", error);
      alert(`Deposit failed: ${error.message || "Check console for details."}`);
    } finally {
      setLoadingTx(false);
    }
  };

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publicKey) return;

    const withdrawNum = Number(amount);
    if (withdrawNum <= 0 || withdrawNum > casinoBalance) {
      alert("Invalid withdrawal amount or insufficient vault balance.");
      return;
    }

    if (!signMessage) {
      alert("Your wallet does not support message signing.");
      return;
    }

    try {
      setLoadingTx(true);
      const timestamp = Date.now();
      const messageString = `Withdraw ${withdrawNum} tokens at timestamp: ${timestamp}`;
      const messageBytes = new TextEncoder().encode(messageString);

      const signatureBytes = await signMessage(messageBytes);
      const signatureBase58 = bs58.encode(signatureBytes);

      const res = await fetch("/api/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: publicKey.toBase58(),
          amount: withdrawNum,
          timestamp,
          signature: signatureBase58,
          tokenCa: TARGET_TOKEN_CA,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to process withdrawal on backend");
      }

      setCasinoBalance(data.newBalance);
      alert(`Successfully withdrew ${withdrawNum} tokens to your wallet!`);
      
      setShowWithdrawModal(false);
      setAmount("");
      fetchWalletBalances();
    } catch (error: any) {
      if (
        error?.message?.includes("User rejected") ||
        error?.code === 4001 ||
        error?.message?.includes("Cancelled")
      ) {
        return;
      }
      console.error("Withdrawal failed:", error);
      alert(`Withdrawal failed: ${error.message || "Check console for details."}`);
    } finally {
      setLoadingTx(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#07070b] text-white bg-[url('/images/bg/bg.png')] bg-cover bg-center bg-no-repeat bg-fixed">
      {/* HEADER */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#07070b]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6 py-4">
          
          {/* LOGO & MOBILE MENU TOGGLE */}
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden text-gray-400 hover:text-white p-1.5 focus:outline-none"
              aria-label="Toggle Menu"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>

            <img 
              src="/images/bg/logo.png" 
              alt="MemeCasino Logo" 
              className="h-8 sm:h-12 w-auto object-contain" 
            />
          </div>

          {/* DESKTOP NAVIGATION */}
          <nav className="hidden gap-6 text-sm font-bold md:flex items-center">
            <button className="text-white">Casino</button>
            <button className="text-gray-400 transition hover:text-white">Jackpot</button>
            <button 
              onClick={() => setShowLeaderboardModal(true)}
              className="text-gray-400 transition hover:text-white"
            >
              Leaderboard
            </button>
            {connected && (
              <button 
                onClick={() => setShowHistoryModal(true)}
                className="text-gray-400 transition hover:text-white"
              >
                History
              </button>
            )}
            <button 
              onClick={() => setShowFairnessModal(true)}
              className="text-cyan-400 hover:text-cyan-300 transition flex items-center gap-1.5 bg-cyan-500/10 border border-cyan-500/30 px-3 py-1.5 rounded-xl text-xs"
            >
              🛡️ Provably Fair
            </button>
          </nav>

          {/* WALLET & BANKING ACTIONS */}
          <div className="flex items-center gap-2 sm:gap-3">
            {connected && (
              <>
                <div className="hidden lg:flex flex-col text-right text-xs bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 font-mono">
                  <span className="text-emerald-400 font-bold">
                    {loadingBalances ? "Loading..." : `${solBalance !== null ? solBalance.toFixed(3) : "0"} SOL`}
                  </span>
                  <span className="text-purple-400 font-bold">
                    {casinoBalance.toLocaleString()} VAULT TOKEN
                  </span>
                </div>

                <button
                  onClick={() => setShowDepositModal(true)}
                  className="rounded-xl bg-emerald-600 px-3 py-2 sm:px-4 sm:py-2.5 text-xs sm:text-sm font-bold transition hover:bg-emerald-500"
                >
                  Deposit
                </button>
                <button
                  onClick={() => setShowWithdrawModal(true)}
                  className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 sm:px-4 sm:py-2.5 text-xs sm:text-sm font-bold transition hover:bg-white/10"
                >
                  Withdraw
                </button>
              </>
            )}

            <WalletConnect />
          </div>
        </div>

        {/* MOBILE DROPDOWN MENU */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-white/10 bg-[#07070b] px-4 py-4 space-y-3">
            <button 
              onClick={() => { setMobileMenuOpen(false); setShowLeaderboardModal(true); }}
              className="block w-full text-left text-sm font-bold text-gray-300 hover:text-white py-2"
            >
              🏆 Leaderboard
            </button>
            {connected && (
              <button 
                onClick={() => { setMobileMenuOpen(false); setShowHistoryModal(true); }}
                className="block w-full text-left text-sm font-bold text-gray-300 hover:text-white py-2"
              >
                📜 History
              </button>
            )}
            <button 
              onClick={() => { setMobileMenuOpen(false); setShowFairnessModal(true); }}
              className="block w-full text-left text-sm font-bold text-cyan-400 hover:text-cyan-300 py-2"
            >
              🛡️ Provably Fair Verification
            </button>
          </div>
        )}
      </header>

      {/* HERO */}
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute left-1/2 top-0 h-[300px] w-[300px] sm:h-[500px] sm:w-[700px] -translate-x-1/2 rounded-full bg-purple-600/10 blur-[120px]" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 py-16 sm:py-24 text-center">
          <h2 className="text-3xl sm:text-5xl md:text-7xl font-black tracking-tight leading-tight">
            Spin Your Way
            <br />
            <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-purple-400 bg-clip-text text-transparent">
              To The Moon
            </span>
          </h2>
          <p className="mx-auto mt-4 sm:mt-6 max-w-xl text-sm sm:text-lg leading-relaxed text-gray-300 px-2">
            Explore the ultimate memecoin slot casino. Choose your favorite game and start spinning.
          </p>

          {/* OFFICIAL CONTRACT ADDRESS BANNER */}
          <div className="mx-auto mt-6 max-w-xl flex items-center justify-between gap-2 rounded-xl border border-purple-500/30 bg-purple-950/30 px-4 py-2.5 backdrop-blur-md">
            <div className="flex items-center gap-2 overflow-hidden text-left">
              <span className="text-xl font-bold uppercase tracking-wider text-purple-400 shrink-0">Official CA:</span>
              <span className="font-mono text-xs text-slate-300 truncate">{TARGET_TOKEN_CA}</span>
            </div>
            <button
              onClick={handleCopyCA}
              className="shrink-0 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-purple-500"
            >
              {copied ? "Copied! ✓" : "Copy CA"}
            </button>
          </div>

          <a
            href="#slots"
            className="mt-6 sm:mt-8 inline-block rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 px-6 py-3 sm:px-8 sm:py-4 text-sm sm:text-base font-black shadow-lg shadow-purple-500/20 transition hover:scale-105"
          >
            Explore Games
          </a>
        </div>
      </section>

      {/* JACKPOT */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 py-8 sm:py-12">
        <div className="rounded-2xl sm:rounded-3xl border border-yellow-500/20 bg-gradient-to-r from-yellow-500/10 to-orange-500/5 p-6 sm:p-8 text-center">
          <p className="text-xs sm:text-sm font-bold uppercase tracking-widest text-purple-400">Progressive Jackpot</p>
          <h3 className="mt-2 sm:mt-3 text-3xl sm:text-4xl md:text-5xl font-black">1,000,000 MEME</h3>
        </div>
      </section>

      {/* SLOT LOBBY */}
      <section id="slots" className="mx-auto max-w-7xl px-4 sm:px-6 py-8 sm:py-12">
        <div className="mb-6 sm:mb-8">
          <p className="text-xs sm:text-sm font-bold uppercase tracking-widest text-purple-400">Casino Lobby</p>
          <h2 className="mt-1 sm:mt-2 text-2xl sm:text-3xl font-black">All Games</h2>
        </div>

        {/* FILTERS */}
        <div className="mb-6 sm:mb-8 flex flex-wrap gap-2 sm:gap-3">
          {categories.map((item) => (
            <button
              key={item}
              onClick={() => setCategory(item)}
              className={`rounded-lg px-3 py-2 sm:px-5 sm:py-3 text-xs sm:text-sm font-bold transition ${
                category === item
                  ? "bg-purple-600 text-white"
                  : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              {item}
            </button>
          ))}
        </div>

        {/* GAMES GRID */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {filteredGames.map((game) => (
            <div
              key={game.name}
              className="group overflow-hidden rounded-2xl border border-white/10 bg-white/5 transition duration-300 hover:-translate-y-2 hover:border-purple-500/50"
            >
              <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-gradient-to-br from-purple-900/40 via-[#12121a] to-pink-900/20">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(168,85,247,0.2),transparent_60%)]" />
                {game.name === "Token Rush" ? 
                (<img src="/images/bg/tkrush.png" alt="Token Rush"
                    className="relative h-full w-full object-cover transition duration-300 group-hover:scale-110"/>) :
                game.name === "Moon Mission" ? 
                (<img src="/images/bg/mm.png" alt="Moon Mission"
                    className="relative h-full w-full object-cover transition duration-300 group-hover:scale-110"/>) :
                game.name === "Meme Fortune" ? 
                (<img src="/images/mf/memefortune.png" alt="Meme Fortune"
                    className="relative h-full w-full object-cover transition duration-300 group-hover:scale-110" /> ) :
                 game.name === "Baccarat" ? 
                (<img src="/images/bg/deckbg.png" alt="Baccarat"
                    className="relative h-full w-full object-cover transition duration-300 group-hover:scale-110"/>):
                game.name === "Chess" ? 
                (<img src="/images/bg/chess.png" alt="Chess"/>):
                 
                 (<span className="relative text-5xl sm:text-7xl transition duration-300 group-hover:scale-125">
                    {game.emoji}</span>
                )}
                <span className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-[10px] sm:text-xs font-bold uppercase text-purple-300">
                  {game.category}
                </span>
              </div>

              <div className="p-4 sm:p-5">
                <p className="text-[10px] sm:text-xs font-bold uppercase text-purple-400">{game.category}</p>
                <h3 className="mt-1 sm:mt-2 text-lg sm:text-xl font-black">{game.name}</h3>
                {game.playable ? (
                  <a
                    href={game.route}
                    className="mt-4 sm:mt-5 block w-full rounded-lg bg-purple-600 py-2.5 sm:py-3 text-center text-xs sm:text-sm font-bold transition hover:bg-purple-500"
                  >
                    Play
                  </a>
                ) : (
                  <button
                    disabled
                    className="mt-4 sm:mt-5 w-full cursor-not-allowed rounded-lg bg-white/5 py-2.5 sm:py-3 text-xs sm:text-sm font-bold text-white-500"
                  >
                    Coming Soon
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* PROVABLY FAIR VERIFIER MODAL */}
      {showFairnessModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-[#0f0f17] rounded-2xl border border-white/10 p-2">
            <button 
              onClick={() => setShowFairnessModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white font-bold text-sm bg-slate-800 w-8 h-8 rounded-full flex items-center justify-center z-10 transition"
            >
              ✕
            </button>
            <ProvablyFairChecker />
          </div>
        </div>
      )}

      {/* LEADERBOARD MODAL */}
      {showLeaderboardModal && (
        <LeaderboardModal onClose={() => setShowLeaderboardModal(false)} />
      )}

      {/* HISTORY MODAL */}
      {showHistoryModal && publicKey && (
        <HistoryModal walletAddress={publicKey.toBase58()} onClose={() => setShowHistoryModal(false)} />
      )}

      {/* DEPOSIT MODAL */}
      {showDepositModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0f0f17] p-5 sm:p-6 shadow-2xl">
            <h3 className="text-xl sm:text-2xl font-black text-emerald-400">Deposit Tokens</h3>
            <p className="mt-1 text-xs sm:text-sm text-gray-400">Transfer tokens into your secure casino vault to play gaslessly.</p>

            <form onSubmit={handleDeposit} className="mt-4 sm:mt-6 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-gray-400 mb-2">Amount</label>
                <input
                  type="number"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none focus:border-emerald-500 text-sm"
                  required
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowDepositModal(false)}
                  className="flex-1 rounded-xl bg-white/5 py-3 text-xs sm:text-sm font-bold text-gray-400 transition hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loadingTx}
                  className="flex-1 rounded-xl bg-emerald-600 py-3 text-xs sm:text-sm font-bold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                >
                  {loadingTx ? "Processing..." : "Deposit"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* WITHDRAW MODAL */}
      {showWithdrawModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0f0f17] p-5 sm:p-6 shadow-2xl">
            <h3 className="text-xl sm:text-2xl font-black text-purple-400">Withdraw Winnings</h3>
            <p className="mt-1 text-xs sm:text-sm text-gray-400">Withdraw your casino session balance back to your Solana wallet.</p>

            <form onSubmit={handleWithdraw} className="mt-4 sm:mt-6 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-gray-400 mb-2">Amount</label>
                <input
                  type="number"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none focus:border-purple-500 text-sm"
                  required
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowWithdrawModal(false)}
                  className="flex-1 rounded-xl bg-white/5 py-3 text-xs sm:text-sm font-bold text-gray-400 transition hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loadingTx}
                  className="flex-1 rounded-xl bg-purple-600 py-3 text-xs sm:text-sm font-bold text-white transition hover:bg-purple-500 disabled:opacity-50"
                >
                  {loadingTx ? "Processing..." : "Withdraw"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer className="border-t border-white/10 px-6 py-8 text-center text-xs sm:text-sm text-white-500">
        <div className="flex flex-col items-center justify-center gap-2 mb-4">
          
        </div>
        <p>© 2026 MemeCasino. All rights reserved.</p>
      </footer>
    </main>
  );
}