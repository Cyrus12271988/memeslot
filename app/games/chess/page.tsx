"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import {
  Clock3,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Users,
  Copy,
} from "lucide-react";


type ChessTable = {
  id: number;
  amount: number;
  time_control_minutes: number;
  status: string;
  seats: { occupied: number; total: number };
  player1: boolean;
  player2: boolean;
  full: boolean;
  matchId: string | null;
};

type ActiveMatch = {
  id: string;
  table_id: number;
  table_amount: number;
  total_pot: number;
  time_control_minutes: number | null;
  status: string;
};

type LobbyResponse = {
  success: boolean;
  balance?: number;
  tables?: ChessTable[];
  activeMatch?: ActiveMatch | null;
  error?: string;
};

type JoinResponse = {
  success: boolean;
  matchId?: string | null;
  vaultBalance?: number;
  message?: string;
  error?: string;
};

const TIME_CONTROLS = [3, 5, 10] as const;
const TABLE_AMOUNTS = [10_000, 25_000, 50_000, 100_000, 500_000] as const;

const formatAmount = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);

const queueKey = (amount: number, minutes: number) => `${amount}-${minutes}`;

export default function ChessLobbyPage() {
  const router = useRouter();
  const { publicKey, connected } = useWallet();
  const walletAddress = publicKey?.toString() ?? "";

  const [balance, setBalance] = useState(0);
  const [tables, setTables] = useState<ChessTable[]>([]);
  const [activeMatch, setActiveMatch] = useState<ActiveMatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadLobby = useCallback(
    async (silent = false) => {
      if (!walletAddress) {
        setBalance(0);
        setTables([]);
        setActiveMatch(null);
        setLoading(false);
        return;
      }

      try {
        silent ? setRefreshing(true) : setLoading(true);
        const response = await fetch(
          `/api/chess?walletAddress=${encodeURIComponent(walletAddress)}`,
          { cache: "no-store" }
        );

        const data: LobbyResponse = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.error || "Unable to load Chess lobby.");
        }

        setBalance(Number(data.balance ?? 0));
        setTables(Array.isArray(data.tables) ? data.tables : []);
        setActiveMatch(data.activeMatch ?? null);
        setError("");
      } catch (e: any) {
        console.error("Chess lobby:", e);
        setError(e?.message || "Unable to load Chess lobby.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [walletAddress]
  );

  useEffect(() => {
    loadLobby();
  }, [loadLobby]);

  useEffect(() => {
    if (!walletAddress) return;
    const timer = setInterval(() => loadLobby(true), 3000);
    return () => clearInterval(timer);
  }, [walletAddress, loadLobby]);

  useEffect(() => {
    if (!activeMatch) return;
    router.replace(
      `/games/chess/game?matchId=${encodeURIComponent(activeMatch.id)}`
    );
  }, [activeMatch, router]);

  const tableMap = useMemo(() => {
    const map = new Map<string, ChessTable>();
    for (const table of tables) {
      map.set(queueKey(table.amount, table.time_control_minutes), table);
    }
    return map;
  }, [tables]);

  const joinTable = async (table: ChessTable) => {
    if (!walletAddress) {
      setError("Connect your wallet first.");
      return;
    }

    if (activeMatch) {
      setError("You already have an active Chess match.");
      return;
    }

    if (table.full || table.status !== "WAITING") {
      setError("This Chess table is not available.");
      return;
    }

    if (balance < table.amount) {
      setError(`Insufficient vault balance. You need ${formatAmount(table.amount)}.`);
      return;
    }

    const key = queueKey(table.amount, table.time_control_minutes);
    if (joining) return;

    try {
      setJoining(key);
      setError("");
      setMessage("");

      const response = await fetch("/api/chess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "join",
          tableId: table.id,
          walletAddress,
          timeControlMinutes: table.time_control_minutes,
        }),
      });

      const data: JoinResponse = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Unable to join Chess table.");
      }

      setBalance(Number(data.vaultBalance ?? balance));
      setMessage(data.message || "Joined Chess table.");

      if (data.matchId) {
        router.replace(
          `/games/chess/game?matchId=${encodeURIComponent(data.matchId)}`
        );
        return;
      }

      await loadLobby(true);
    } catch (e: any) {
      console.error("Chess join:", e);
      setError(e?.message || "Unable to join Chess table.");
    } finally {
      setJoining(null);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-[#05070a] text-white">
        <div className="flex min-h-screen items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-amber-400/20 blur-xl animate-pulse" />
              <Loader2 className="relative h-10 w-10 animate-spin text-amber-400" />
            </div>
            <span className="text-sm font-medium tracking-wide text-slate-400">
              Loading Chess Arena...
            </span>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#05070a] text-white selection:bg-amber-400/20 selection:text-amber-200 overflow-x-hidden">
      {/* Animated background */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        {/* Chessboard pattern */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `
              linear-gradient(45deg, #ffffff 25%, transparent 25%),
              linear-gradient(-45deg, #ffffff 25%, transparent 25%),
              linear-gradient(45deg, transparent 75%, #ffffff 75%),
              linear-gradient(-45deg, transparent 75%, #ffffff 75%)
            `,
            backgroundSize: "40px 40px",
            backgroundPosition: "0 0, 0 20px, 20px -20px, -20px 0px",
          }}
        />

        {/* Floating glows */}
        <div className="absolute left-1/2 top-[-180px] h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-amber-500/[0.05] blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-120px] right-[-80px] h-[420px] w-[420px] rounded-full bg-emerald-500/[0.04] blur-[100px]" />
        <div className="absolute top-1/3 left-[-100px] h-[300px] w-[300px] rounded-full bg-amber-400/[0.03] blur-[80px]" />
      </div>

      <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="mb-6 overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0a0c10]/70 backdrop-blur-xl shadow-2xl shadow-black/40">
          <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
            <div className="flex items-center gap-4">
              <Link
                href="/"
                className="text-xs font-semibold text-slate-400 transition hover:text-white"
              >
                ← Lobby
              </Link>

              <button
                onClick={() => {
                  navigator.clipboard.writeText(
                    "FhgGyS6mC4ZFd2KG5hJLGbiz7skgBaL7fkg2J79upump"
                  );
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:border-amber-400/40 hover:bg-amber-400/10 hover:text-amber-300"
              >
                <Copy className="h-3 w-3" />
                Copy CA
              </button>

              <div className="flex items-center gap-3">
                <div className="relative flex h-12 w-12 items-center justify-center rounded-xl border border-amber-400/25 bg-gradient-to-br from-amber-400/15 to-transparent text-2xl shadow-lg shadow-amber-950/30">
                  <span className="animate-pulse">♟</span>
                  <div className="absolute inset-0 rounded-xl bg-amber-400/10 blur-md" />
                </div>
                <div>
                  <h1 className="text-lg font-bold tracking-tight sm:text-xl">
                    CHESS ARENA
                  </h1>
                  <p className="text-[11px] text-slate-500">Player vs Player · Live Queues</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-4 py-2 shadow-inner shadow-emerald-950/20">
                <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                  Vault Balance
                </div>
                <div className="mt-0.5 font-mono text-sm font-bold text-emerald-400">
                  {formatAmount(balance)}
                </div>
              </div>

              <button
                type="button"
                onClick={() => loadLobby(true)}
                disabled={refreshing}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] transition hover:border-amber-400/40 hover:bg-amber-400/10 disabled:opacity-40"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin text-amber-400" : ""}`} />
              </button>
            </div>
          </div>
        </header>

        {/* Wallet warning */}
        {!connected || !walletAddress ? (
          <section className="mb-6 rounded-2xl border border-amber-400/25 bg-gradient-to-r from-amber-400/10 via-amber-400/5 to-transparent px-6 py-5 text-center shadow-lg shadow-amber-950/10">
            <p className="font-semibold text-amber-300">Connect your wallet to enter the arena</p>
            <p className="mt-1 text-sm text-slate-400">
              Vault balance and live tables appear after connecting.
            </p>
          </section>
        ) : null}

        {/* Error / Message */}
        {error && (
          <div className="mb-4 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300 animate-in fade-in">
            {error}
          </div>
        )}
        {message && (
          <div className="mb-4 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-300 animate-in fade-in">
            {message}
          </div>
        )}

        {/* Info banner */}
        <section className="mb-8 flex items-start gap-3 rounded-2xl border border-white/[0.07] bg-[#0a0c10]/60 px-5 py-4 backdrop-blur-sm">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
          <div>
            <h2 className="text-sm font-semibold">Exact Match Queues</h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-400">
              Select time control + stake. You only get matched with players in the exact same queue.
            </p>
          </div>
        </section>

        {/* Tables */}
        <div className="space-y-10">
          {TIME_CONTROLS.map((minutes) => (
            <section key={minutes}>
              {/* Section header */}
              <div className="mb-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-amber-400/20 bg-amber-400/10 shadow-lg shadow-amber-950/20">
                    <Clock3 className="h-5 w-5 text-amber-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold tracking-tight">{minutes}:00</h2>
                    <p className="text-[11px] text-slate-500">
                      {minutes === 3 ? "Bullet Speed" : minutes === 5 ? "Blitz" : "Longer Blitz"}
                    </p>
                  </div>
                </div>
                <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  5 Live Tables
                </span>
              </div>

              {/* Cards grid */}
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                {TABLE_AMOUNTS.map((amount) => {
                  const table = tableMap.get(queueKey(amount, minutes));
                  const occupied = table?.seats.occupied ?? 0;
                  const full = table?.full ?? false;
                  const available = table?.status === "WAITING";
                  const affordable = balance >= amount;
                  const key = queueKey(amount, minutes);
                  const isJoining = joining === key;

                  const disabled =
                    !connected ||
                    !walletAddress ||
                    !table ||
                    full ||
                    !available ||
                    !affordable ||
                    joining !== null;

                  return (
                    <article
                      key={key}
                      className="group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0a0c10]/90 transition-all duration-300 hover:-translate-y-1.5 hover:border-amber-400/40 hover:shadow-2xl hover:shadow-amber-950/30"
                    >
                      {/* Subtle top glow on hover */}
                      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/50 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

                      <div className="relative p-4">
                        {/* Amount + seats */}
                        <div className="mb-4 flex items-start justify-between">
                          <div>
                            <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                              Stake
                            </div>
                            <div className="mt-1 font-mono text-xl font-bold text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.3)]">
                              {formatAmount(amount)}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-slate-400">
                            <Users className="h-3.5 w-3.5" />
                            {occupied}/2
                          </div>
                        </div>

                        {/* Time */}
                        <div className="mb-3 flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                          <span className="text-[10px] font-medium uppercase text-slate-500">Time</span>
                          <span className="font-mono text-sm font-bold text-amber-400">
                            {minutes}:00
                          </span>
                        </div>

                        {/* Player seats */}
                        <div className="mb-3 grid grid-cols-2 gap-2">
                          {[table?.player1, table?.player2].map((ready, index) => (
                            <div
                              key={index}
                              className={`relative overflow-hidden rounded-xl border px-2 py-2.5 text-center transition-all ${
                                ready
                                  ? "border-amber-400/40 bg-amber-400/15 shadow-[0_0_12px_rgba(251,191,36,0.15)]"
                                  : "border-white/[0.06] bg-white/[0.02]"
                              }`}
                            >
                              {ready && (
                                <div className="absolute inset-0 animate-pulse bg-amber-400/10" />
                              )}
                              <div className="relative text-[9px] font-medium uppercase text-slate-500">
                                P{index + 1}
                              </div>
                              <div
                                className={`relative mt-0.5 text-[11px] font-bold ${
                                  ready ? "text-amber-300" : "text-slate-600"
                                }`}
                              >
                                {ready ? "READY" : "OPEN"}
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Status messages */}
                        {!table ? (
                          <div className="mb-3 rounded-lg border border-red-500/25 bg-red-500/10 px-2 py-1.5 text-center text-[10px] font-medium text-red-300">
                            QUEUE UNAVAILABLE
                          </div>
                        ) : full ? (
                          <div className="mb-3 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1.5 text-center text-[10px] font-medium text-slate-500">
                            TABLE FULL
                          </div>
                        ) : !available ? (
                          <div className="mb-3 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1.5 text-center text-[10px] font-medium text-slate-500">
                            MATCH IN PROGRESS
                          </div>
                        ) : null}

                        {!affordable && connected ? (
                          <div className="mb-3 rounded-lg border border-red-500/25 bg-red-500/10 px-2 py-1.5 text-center text-[10px] font-medium text-red-300">
                            NEED {formatAmount(amount)}
                          </div>
                        ) : null}

                        {/* Join button */}
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => table && joinTable(table)}
                          className="relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-3 py-3 text-xs font-bold tracking-wide text-slate-950 shadow-lg shadow-amber-900/30 transition-all hover:from-amber-300 hover:to-amber-400 hover:shadow-amber-900/50 active:scale-[0.98] disabled:cursor-not-allowed disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 disabled:shadow-none"
                        >
                          {/* Shine effect */}
                          <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                          
                          {isJoining ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              JOINING...
                            </>
                          ) : full ? (
                            "TABLE FULL"
                          ) : !connected ? (
                            "CONNECT WALLET"
                          ) : !table ? (
                            "UNAVAILABLE"
                          ) : !affordable ? (
                            "INSUFFICIENT"
                          ) : !available ? (
                            "IN PROGRESS"
                          ) : (
                            "JOIN TABLE"
                          )}
                        </button>

                        <div className="mt-2.5 text-center text-[9px] font-medium uppercase tracking-wider text-slate-600">
                          95% of total pot → winner
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        {/* Footer info */}
        <section className="mt-12 rounded-2xl border border-white/[0.06] bg-[#0a0c10]/50 px-5 py-6 backdrop-blur-sm">
          <div className="grid gap-6 text-xs text-slate-500 sm:grid-cols-3">
            <div>
              <div className="mb-1.5 font-semibold text-slate-300">15 Live Queues</div>
              <div>3 / 5 / 10 min across five stake levels</div>
            </div>
            <div>
              <div className="mb-1.5 font-semibold text-slate-300">Exact Matching</div>
              <div>Time control + stake must match exactly</div>
            </div>
            <div>
              <div className="mb-1.5 font-semibold text-slate-300">Server Controlled</div>
              <div>Entry, clocks & settlement handled server-side</div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}