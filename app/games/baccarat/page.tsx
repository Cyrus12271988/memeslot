"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

// ============================================================
// BACCARAT LOBBY
//
// This page deliberately loads the room list from the server.
// The database is the authority for room names and betting limits.
// ============================================================

type BaccaratRoom = {
  id: number;
  roomName: string;
  minBet: number;
  maxBet: number;
  maxExposure: number;
  tieMinBet: number;
  tieMaxBet: number;
  level: string;
  active: boolean;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatCompact(value: number) {
  if (!Number.isFinite(value)) return "0";
  if (value >= 1_000_000) {
    const n = value / 1_000_000;
    return Number.isInteger(n) ? `${n}M` : `${n.toFixed(1)}M`;
  }
  if (value >= 1_000) {
    const n = value / 1_000;
    return Number.isInteger(n) ? `${n}K` : `${n.toFixed(1)}K`;
  }
  return formatNumber(value);
}

function levelClasses(level: string) {
  const value = level.toUpperCase();
  if (value === "WHALE") {
    return {
      text: "text-amber-300",
      border: "border-amber-300/20 hover:border-amber-300/40",
      glow: "bg-amber-400/10",
      icon: "border-amber-300/20 bg-amber-400/10",
      enter: "border-amber-300/10 bg-amber-400/[0.04]",
    };
  }
  if (value === "ELITE") {
    return {
      text: "text-purple-300",
      border: "border-purple-300/15 hover:border-purple-300/35",
      glow: "bg-purple-400/10",
      icon: "border-purple-300/20 bg-purple-400/10",
      enter: "border-purple-300/10 bg-purple-400/[0.04]",
    };
  }
  if (value === "VIP" || value === "ROYAL") {
    return {
      text: "text-cyan-300",
      border: "border-cyan-300/15 hover:border-cyan-300/35",
      glow: "bg-cyan-400/10",
      icon: "border-cyan-300/20 bg-cyan-400/10",
      enter: "border-cyan-300/10 bg-cyan-400/[0.04]",
    };
  }
  return {
    text: "text-emerald-300",
    border: "border-white/[0.07] hover:border-emerald-300/25",
    glow: "bg-emerald-400/10",
    icon: "border-emerald-300/15 bg-emerald-400/10",
    enter: "border-emerald-300/10 bg-emerald-400/[0.035]",
  };
}

function RoomCard({ room }: { room: BaccaratRoom }) {
  const classes = levelClasses(room.level);

  return (
    <Link href={`/games/baccarat/room/${room.id}`} className="group relative block">
      <article
        className={[
          "relative overflow-hidden rounded-3xl border bg-[#0b100d]/95",
          "transition-all duration-200 hover:-translate-y-1",
          "hover:shadow-[0_18px_50px_rgba(0,0,0,.35)] active:scale-[0.99]",
          classes.border,
        ].join(" ")}
      >
        <div className="absolute inset-x-0 top-0 h-px bg-emerald-300/30" />
        <div
          className={`pointer-events-none absolute -right-16 -top-16 h-36 w-36 rounded-full blur-3xl ${classes.glow}`}
        />

        <div className="relative p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border text-xl ${classes.icon}`}
              >
                ♠
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-black tracking-[0.08em] text-white">
                  {room.roomName}
                </div>
                <div className="mt-1 text-[7px] font-bold uppercase tracking-[0.2em] text-white/25">
                  Room {room.id}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-300/10 bg-emerald-400/[0.04] px-2.5 py-1.5">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              <span className="text-[7px] font-black uppercase tracking-[0.14em] text-emerald-300">
                Live
              </span>
            </div>
          </div>

          <div className="mt-6">
            <div className="text-[7px] font-bold uppercase tracking-[0.2em] text-white/25">
              Betting Range
            </div>
            <div className="mt-2 flex items-end justify-between gap-3">
              <div>
                <div className="text-2xl font-black tabular-nums text-white">
                  {formatCompact(room.minBet)}
                </div>
                <div className="mt-0.5 text-[7px] font-bold uppercase tracking-[0.14em] text-white/20">
                  Minimum
                </div>
              </div>
              <div className="pb-3 text-white/15">→</div>
              <div className="text-right">
                <div className={`text-2xl font-black tabular-nums ${classes.text}`}>
                  {formatCompact(room.maxBet)}
                </div>
                <div className="mt-0.5 text-[7px] font-bold uppercase tracking-[0.14em] text-white/20">
                  Maximum
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.025] px-3 py-2.5">
              <div className="text-[7px] font-bold uppercase tracking-[0.16em] text-white/20">
                Level
              </div>
              <div className="mt-1 text-[9px] font-black uppercase tracking-[0.12em] text-white/60">
                {room.level}
              </div>
            </div>
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.025] px-3 py-2.5 text-right">
              <div className="text-[7px] font-bold uppercase tracking-[0.16em] text-white/20">
                Tie
              </div>
              <div className="mt-1 text-[9px] font-black uppercase tracking-[0.12em] text-emerald-300/70">
                {formatCompact(room.tieMinBet)}–{formatCompact(room.tieMaxBet)}
              </div>
            </div>
          </div>

          <div className={`mt-4 flex items-center justify-between rounded-xl border px-3 py-2.5 ${classes.enter}`}>
            <span className="text-[8px] font-black uppercase tracking-[0.16em] text-white/45">
              Enter Table
            </span>
            <span className={`text-sm font-black transition-transform duration-200 group-hover:translate-x-1 ${classes.text}`}>
              →
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}

export default function BaccaratLobbyPage() {
  const [rooms, setRooms] = useState<BaccaratRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);

  const loadRooms = useCallback(async () => {
    try {
      const response = await fetch("/api/baccarat", {
        cache: "no-store",
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data?.error || "Unable to load Baccarat rooms.");
      }

      const nextRooms = Array.isArray(data.rooms) ? data.rooms : [];
      setRooms(nextRooms);
      setError("");
    } catch (err: any) {
      console.error("Baccarat lobby:", err);
      setError(err?.message || "Unable to load Baccarat rooms.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    loadRooms();
  }, [loadRooms]);

  const activeRooms = useMemo(() => rooms.filter((room) => room.active), [rooms]);
  const minimumBet = activeRooms.length
    ? Math.min(...activeRooms.map((room) => room.minBet))
    : 0;
  const maximumBet = activeRooms.length
    ? Math.max(...activeRooms.map((room) => room.maxBet))
    : 0;

  return (
    <main className="min-h-screen bg-[#050807] text-white">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(22,78,49,.18),transparent_45%)]" />
        <div className="absolute left-0 top-1/3 h-96 w-96 rounded-full bg-emerald-500/[0.025] blur-3xl" />
        <div className="absolute bottom-0 right-0 h-96 w-96 rounded-full bg-amber-500/[0.02] blur-3xl" />
      </div>

      <div className="relative mx-auto w-full max-w-7xl px-3 py-3 sm:px-5 sm:py-5">
        <header className="sticky top-3 z-50 mb-5 rounded-2xl border border-white/[0.07] bg-[#090d0b]/95 shadow-[0_12px_40px_rgba(0,0,0,.3)] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3 px-3 py-2.5 sm:px-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <Link
                href="/"
                className="shrink-0 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-[10px] font-bold text-white/55 transition hover:border-emerald-300/25 hover:text-white"
              >
                ← Lobby
              </Link>
              <div className="hidden h-6 w-px bg-white/[0.06] sm:block" />
              <div className="min-w-0">
                <div className="truncate text-sm font-black tracking-[0.08em] text-white">
                  BACCARAT
                </div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                  <span className="text-[7px] font-bold uppercase tracking-[0.2em] text-emerald-300/60">
                    Live Tables
                  </span>
                </div>
              </div>
            </div>

            <div className="shrink-0">
              {mounted ? (
                <WalletMultiButton />
              ) : (
                <div className="flex h-10 min-w-[150px] items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.035]" />
              )}
            </div>
          </div>
        </header>

        <section className="mb-5 overflow-hidden rounded-[28px] border border-emerald-300/[0.08] bg-[radial-gradient(circle_at_50%_20%,rgba(18,71,44,.30),transparent_55%),#080d0a]">
          <div className="relative px-5 py-8 text-center sm:px-8 sm:py-10">
            <div className="pointer-events-none absolute left-1/2 top-0 h-40 w-96 -translate-x-1/2 rounded-full bg-emerald-400/[0.05] blur-3xl" />
            <div className="relative">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-300/10 bg-emerald-400/[0.035] px-3 py-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span className="text-[7px] font-black uppercase tracking-[0.24em] text-emerald-300/70">
                  Choose Your Table
                </span>
              </div>
              <h1 className="text-3xl font-black tracking-[-0.03em] text-white sm:text-5xl">
                Baccarat Rooms
              </h1>
              <p className="mx-auto mt-3 max-w-xl text-xs leading-6 text-white/30 sm:text-sm">
                Select a table based on its live server-side betting limits.
                Each room runs its own Baccarat round and 8-deck shoe.
              </p>
            </div>
          </div>
        </section>

        {error && (
          <div className="mb-5 rounded-2xl border border-red-500/25 bg-red-950/30 px-4 py-3 text-sm font-semibold text-red-300">
            {error}
          </div>
        )}

        <div className="mb-5 grid grid-cols-3 gap-2.5 sm:gap-3">
          <div className="rounded-2xl border border-white/[0.06] bg-[#090d0b]/90 px-3 py-3.5 text-center">
            <div className="text-xl font-black text-white sm:text-2xl">{activeRooms.length}</div>
            <div className="mt-1 text-[7px] font-bold uppercase tracking-[0.18em] text-white/20">Live Rooms</div>
          </div>
          <div className="rounded-2xl border border-white/[0.06] bg-[#090d0b]/90 px-3 py-3.5 text-center">
            <div className="text-xl font-black text-emerald-300 sm:text-2xl">{minimumBet ? formatCompact(minimumBet) : "—"}</div>
            <div className="mt-1 text-[7px] font-bold uppercase tracking-[0.18em] text-white/20">Starting Bet</div>
          </div>
          <div className="rounded-2xl border border-white/[0.06] bg-[#090d0b]/90 px-3 py-3.5 text-center">
            <div className="text-xl font-black text-amber-300 sm:text-2xl">{maximumBet ? formatCompact(maximumBet) : "—"}</div>
            <div className="mt-1 text-[7px] font-bold uppercase tracking-[0.18em] text-white/20">Max Bet</div>
          </div>
        </div>

        <section>
          <div className="mb-3 flex items-end justify-between gap-3 px-1">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.16em] text-white">Baccarat Tables</div>
              <div className="mt-1 text-[9px] text-white/20">Pick a room to enter the live table</div>
            </div>
            <div className="text-[8px] font-bold uppercase tracking-[0.16em] text-emerald-300/50">
              {activeRooms.length} Tables
            </div>
          </div>

          {loading ? (
            <div className="rounded-3xl border border-white/[0.06] bg-[#090d0b]/90 py-20 text-center">
              <div className="text-3xl">🃏</div>
              <div className="mt-3 text-sm font-bold text-slate-300">Loading Baccarat tables...</div>
            </div>
          ) : activeRooms.length === 0 ? (
            <div className="rounded-3xl border border-white/[0.06] bg-[#090d0b]/90 py-20 text-center text-sm text-slate-500">
              No active Baccarat rooms are available.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {activeRooms.map((room) => (
                <RoomCard key={room.id} room={room} />
              ))}
            </div>
          )}
        </section>

        <section className="mt-5 rounded-2xl border border-white/[0.06] bg-[#090d0b]/90 p-4 sm:p-5">
          <div className="mb-3 text-[8px] font-black uppercase tracking-[0.2em] text-white/25">Room Limits</div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-4">
            {activeRooms.map((room) => (
              <Link
                key={room.id}
                href={`/games/baccarat/room/${room.id}`}
                className="flex items-center justify-between border-b border-white/[0.04] py-2 transition hover:text-white"
              >
                <span className="text-[8px] font-bold uppercase tracking-[0.1em] text-white/35">{room.roomName}</span>
                <span className="text-[8px] font-black tabular-nums text-white/55">
                  {formatCompact(room.minBet)}-{formatCompact(room.maxBet)}
                </span>
              </Link>
            ))}
          </div>
        </section>

        <footer className="py-6 text-center">
          <div className="text-[7px] font-bold uppercase tracking-[0.22em] text-white/15">
            Baccarat • Live Tables • Server Controlled
          </div>
        </footer>
      </div>
    </main>
  );
}