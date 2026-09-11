"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import ProvablyFairChecker from "../../components/ProvablyFairChecker";
import RouletteRoadMap from "../../components/RouletteRoadMap"; 

const RED_NUMBERS = [
  1, 3, 5, 7, 9,
  12, 14, 16, 18,
  19, 21, 23, 25, 27,
  30, 32, 34, 36,
];
const ROULETTE_WHEEL_SEQUENCE: Array<number | "00"> = [
  // Green 0
  0,

  // Red / Black alternating
  19, 2,
  21, 4,
  25, 6,
  27, 13,
  36, 11,
  30, 8,
  23, 10,
  5, 24,
  16, 33,

  // Green 00
  "00",

  // Continue Red / Black alternating
  1, 20,
  14, 31,
  9, 22,
  18, 29,
  7, 28,
  12, 35,
  3, 26,
  32, 15,
  34, 17,
];

type BetType = "number" | "red" | "black" | "even" | "odd" | "low" | "high" | "dozen" | "column";

interface Bet {
  type: BetType;
  value?: number | "00";
  dozenIndex?: number;
  columnIndex?: number;
  amount: number;
}

function WalletConnect() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return <button disabled className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-400 text-xs font-bold">Select Wallet</button>;
  }
  return <WalletMultiButton style={{ height: "28px", minHeight: "28px", fontSize: "10px", borderRadius: "6px" }} />;
}

export default function MemeFortunePage() {
  const { publicKey } = useWallet();
  const [balance, setBalance] = useState(0);
  const [selectedChip, setSelectedChip] = useState(0);
  const [bets, setBets] = useState<Bet[]>([]);

  const [gamePhase, setGamePhase] = useState<"betting" | "spinning">("betting");
  const [timeLeft, setTimeLeft] = useState(0);
  const [roundId, setRoundId] = useState<number | null>(null);
  const [gmtTime, setGmtTime] = useState("--:--:--");
  const [winningNumber, setWinningNumber] = useState<number | "00" | null>(null);
  const [history, setHistory] = useState<Array<number | "00">>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [wheelRotation, setWheelRotation] = useState(0);

  const [showFairnessModal, setShowFairnessModal] = useState(false);
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  
  const lastProcessedRoundRef = useRef<number | null>(null);
  const resultRevealTimerRef = useRef<number | null>(null);

  const triggerWheelSpinAnimation = useCallback(
    (targetNumber: number | "00") => {
      const winningIndex = ROULETTE_WHEEL_SEQUENCE.findIndex(
        (value) => String(value) === String(targetNumber)
      );

      if (winningIndex < 0) return;

      const degreesPerPocket = 360 / ROULETTE_WHEEL_SEQUENCE.length;
      const targetAngle = winningIndex * degreesPerPocket;
      const randomFullSpins = 3600;

      setWheelRotation((previous) => {
        const currentMod = ((previous % 360) + 360) % 360;
        const deltaToTarget = (360 - currentMod - targetAngle + 360) % 360;
        return previous + randomFullSpins + deltaToTarget;
      });
    },
    []
  );

  const fetchGlobalGameState = useCallback(async () => {
    try {
      const wallet = publicKey ? publicKey.toBase58() : "global_guest";
      const res = await fetch(`/api/memefortune?walletAddress=${encodeURIComponent(wallet)}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data?.success) {
          if (typeof data.balance === "number") setBalance(data.balance);
          if (Array.isArray(data.myBets)) setBets(data.myBets);

          const serverState = data.gameState;
          if (serverState) {
            setRoundId(serverState.roundId ?? null);
            setTimeLeft(serverState.countdown);
            setGamePhase(serverState.status);

            if (serverState.status === "spinning") {
              if (lastProcessedRoundRef.current !== serverState.roundId) {
                lastProcessedRoundRef.current = serverState.roundId;
                const targetNumber = serverState.winningNumber;
                setWinningNumber(null);
                triggerWheelSpinAnimation(targetNumber);

                if (resultRevealTimerRef.current !== null) {
                  window.clearTimeout(resultRevealTimerRef.current);
                }

                resultRevealTimerRef.current = window.setTimeout(() => {
                  setWinningNumber(targetNumber);
                  resultRevealTimerRef.current = null;
                }, 4700);
              }
            } else if (serverState.status === "betting") {
              setHistory(serverState.recentNumbers || []);
              if (serverState.countdown <= 10) {
                const latestResult = serverState.recentNumbers?.[0];
                if (latestResult !== undefined) {
                  setWinningNumber(latestResult);
                }
              }
            }
          }
        }
      }
    } catch (err) {
      console.error("Failed to sync global game state:", err);
    }
  }, [publicKey, triggerWheelSpinAnimation]);

  useEffect(() => {
    const updateGMTClock = () => {
      const now = new Date();
      setGmtTime(
        now.toLocaleTimeString("en-GB", {
          timeZone: "Etc/GMT",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        })
      );
    };

    updateGMTClock();
    const clockInterval = window.setInterval(updateGMTClock, 1000);

    fetchGlobalGameState();
    const interval = window.setInterval(fetchGlobalGameState, 1000);

    return () => {
      window.clearInterval(clockInterval);
      window.clearInterval(interval);

      if (resultRevealTimerRef.current !== null) {
        window.clearTimeout(resultRevealTimerRef.current);
        resultRevealTimerRef.current = null;
      }
    };
  }, [fetchGlobalGameState]);

  const placeBet = async (type: BetType, value?: number | "00", dozenIndex?: number, columnIndex?: number) => {
    if (gamePhase !== "betting" || timeLeft <= 2) {
      setErrorMsg("Betting is closed for this round!");
      return;
    }

    const chipAmount = Number(selectedChip);
    const MIN_BET = 10000;

    if (chipAmount < MIN_BET) {
      setErrorMsg(`Minimum bet is $${MIN_BET.toLocaleString()}`);
      return;
    }

    setErrorMsg(null);

    const newBetPayload: Bet = { type, amount: chipAmount };
    if (type === "number") newBetPayload.value = value;
    if (type === "dozen") newBetPayload.dozenIndex = Number(dozenIndex);
    if (type === "column") newBetPayload.columnIndex = Number(columnIndex);

    try {
      const res = await fetch("/api/memefortune", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: publicKey ? publicKey.toBase58() : "global_guest",
          bets: [newBetPayload],
        }),
      });
      const data = await res.json();
      if (res.ok && data?.success) {
        setBalance(data.newBalance);
        if (Array.isArray(data.myBets)) setBets(data.myBets);
      } else {
        setErrorMsg(data?.error || "Failed to place bet");
      }
    } catch (err) {
      console.error("Error placing bet:", err);
    }
  };

  const clearBets = async () => {
    if (gamePhase !== "betting" || timeLeft <= 2) {
      setErrorMsg("Bets can only be cleared while betting is open.");
      return;
    }

    if (bets.length === 0) {
      setErrorMsg("There are no bets to clear.");
      return;
    }

    setErrorMsg(null);

    try {
      const res = await fetch("/api/memefortune", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: publicKey ? publicKey.toBase58() : "global_guest",
        }),
      });

      const data = await res.json();

      if (res.ok && data?.success) {
        setBets([]);
        if (typeof data.balance === "number") {
          setBalance(data.balance);
        }
        setErrorMsg(`All bets cleared. $${Number(data.refundedAmount || 0).toLocaleString()} returned.`);
      } else {
        setErrorMsg(data?.error || "Failed to clear bets.");
      }
    } catch (err) {
      console.error("Error clearing bets:", err);
      setErrorMsg("Failed to clear bets. Please try again.");
    }
  };

  const totalBetAmount = bets.reduce((sum, b) => sum + Number(b.amount), 0);
  const getBet = (type: BetType, value?: number | "00", dozenIndex?: number, columnIndex?: number) =>
    bets.find((b) => b.type === type && b.value === value && b.dozenIndex === dozenIndex && b.columnIndex === columnIndex);
  const isRed = (num: number) => RED_NUMBERS.includes(num);

  const row1Numbers = [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34];
  const row2Numbers = [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35];
  const row3Numbers = [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36];

  const tickerMessage =
    gamePhase === "spinning"
      ? `🎡 WHEEL SPINNING ★ ROUND #${roundId ?? "—"} ★ GOOD LUCK ★ WAIT FOR THE RESULT`
      : timeLeft <= 10
        ? `⚠️ FINAL BETS ★ BETTING CLOSES SOON ★ ROUND #${roundId ?? "—"} ★ ${timeLeft}s REMAINING`
        : `🟢 BETTING OPEN ★ ROUND #${roundId ?? "—"} ★ ${timeLeft}s TO PLACE YOUR BETS ★ GOOD LUCK!`;

  return (
    <main className="min-h-screen w-full bg-[#031b12] text-white flex justify-center px-2 py-2 sm:py-3 relative overflow-hidden">
      
     {/* BACKGROUND IMAGE & BLACK OVERLAY */}
<div
  className="absolute inset-0 z-0 bg-cover bg-center  pointer-events-none"
  style={{ backgroundImage: `url('/images/mf/memefortune.png')` }}
/>

<div className="absolute inset-0 z-0 bg-black/80 pointer-events-none" />
      {/* MAIN CONTAINER */}
      <div className="w-full max-w-[620px] flex flex-col gap-1 relative z-10">

        {/* =========================================================
            TOP BAR — Lobby, Timer, Vault Balance, Wallet & Modals
        ========================================================= */}
        <header className="w-full h-11 bg-[#062318]/90 backdrop-blur-md border border-[#174f35] rounded-lg px-2.5 flex items-center justify-between gap-2 shadow-md">
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/"
              className="text-[10px] font-bold text-emerald-300 hover:text-white transition flex items-center gap-1"
            >
              <span>←</span> Lobby
            </Link>
          </div>
{/* COPY CONTRACT ADDRESS */}
    <button
      onClick={() => {
        navigator.clipboard.writeText(
          "FhgGyS6mC4ZFd2KG5hJLGbiz7skgBaL7fkg2J79upump"
        );
      }}
      className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-950/80 hover:bg-slate-800/90 text-slate-300 hover:text-amber-400 text-xs font-bold rounded-xl border border-slate-700/60 shadow-md transition-all active:scale-95"
    >
      📋 Copy CA
    </button>
          <div className="flex items-center gap-1.5 shrink-0">
            
            <div className="flex flex-col text-right pl-1 border-l border-[#174f35]">
              <span className="text-[6px] text-emerald-400 uppercase font-semibold leading-none">Vault Balance</span>
              <span className="text-[10px] font-mono font-bold text-white leading-tight">${balance.toLocaleString()}</span>
            </div>

            <div className="scale-90 origin-right">
              <WalletConnect />
            </div>

            <button
              onClick={() => setShowPayoutModal(true)}
              className="h-6 px-2 rounded border border-amber-600/40 bg-amber-950/50 text-[8px] font-bold text-amber-300 hover:text-white transition"
            >
              Payouts
            </button>
            <button
              onClick={() => setShowFairnessModal(true)}
              className="h-6 px-2 rounded border border-cyan-600/40 bg-cyan-950/50 text-[8px] font-bold text-cyan-300 hover:text-white transition"
            >
              Fair
            </button>
          </div>
        </header>

        {/* =========================================================
            GAME HEADER — Title, Wheel & CA Copy Box
        ========================================================= */}
        <section className="w-full bg-[#062318]/80 backdrop-blur-md border border-[#174f35] rounded-xl p-3 flex items-center justify-between gap-4 shadow-inner">
          <div className="flex flex-col justify-center min-w-0 pl-1">
            <span className="text-[20px] tracking-widest text-amber-300 font-black uppercase">
              ★MEME FORTUNE ★
            </span>
            <h1 className="text-[38px] sm:text-[44px] leading-[0.9] font-black italic tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-slate-100 via-sky-200 to-slate-400 font-serif my-1">
              Roulette
            </h1>
              <span className="text-[16px] text-emerald-300 tracking-[0.2em] uppercase font-bold">
                Meme Edition
              </span>
            
 <div className="mt-1 flex items-center justify-center gap-1.5 whitespace-nowrap text-[8px] font-bold sm:gap-2 sm:text-[10px]">
                    <span className="text-slate-400"> MIN <span className="text-white">10,000</span></span>
                    <span className="text-slate-600">•</span>
                    <span className="text-slate-400">MAX <span className="text-white">50,000</span><span className="text-WHITE-500"> / NUMBER</span></span>
                    <span className="text-slate-600"></span></div>
<div className="mt-1 flex items-center justify-center gap-1.5 whitespace-nowrap text-[8px] font-bold sm:gap-2 sm:text-[10px]">
  <span className="text-slate-400">MAX</span><span className="text-WHITE-400">100,000/BET</span> 
                  <span className="text-slate-400">MAX GLOBAL </span><span className="text-WHITE-400">5,000,000</span> </div></div>
            
          
          <div className="relative w-[180px] h-[180px] sm:w-[200px] sm:h-[200px] shrink-0 flex items-center justify-center rounded-full p-1 bg-gradient-to-br from-[#4a2e18] via-[#2c180a] to-[#140b04] border-[3px] border-[#59371d] shadow-[0_4px_14px_rgba(0,0,0,0.6)]">
            <div className="absolute -top-1.5 z-40 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[12px] border-t-amber-400 drop-shadow-md" />

            <div
              className="w-full h-full rounded-full relative flex items-center justify-center overflow-hidden"
              style={{
                transform: `rotate(${wheelRotation}deg)`,
                transition: "transform 4.5s cubic-bezier(0.15, 0.85, 0.15, 1)",
              }}
            >
              <div
                className="absolute inset-[10px] rounded-full"
                style={{
                  background: (() => {
                    const step = 360 / ROULETTE_WHEEL_SEQUENCE.length;
                    const stops = ROULETTE_WHEEL_SEQUENCE.map((num, idx) => {
                      const start = idx * step;
                      const end = (idx + 1) * step;
                      const color =
                        num === 0 || num === "00"
                          ? "#059669"
                          : isRed(num)
                            ? "#dc2626"
                            : "#050b09";
                      return `${color} ${start}deg ${end}deg`;
                    }).join(", ");
                    return `conic-gradient(from ${-step / 2}deg, ${stops})`;
                  })(),
                }}
              />

              <div className="absolute inset-[10px] rounded-full border-[6px] border-[#160c05] pointer-events-none" />

              {ROULETTE_WHEEL_SEQUENCE.map((_, idx) => {
                const step = 360 / ROULETTE_WHEEL_SEQUENCE.length;
                const angle = idx * step - step / 2;
                return (
                  <div
                    key={`separator-${idx}`}
                    className="absolute inset-[10px] rounded-full pointer-events-none"
                    style={{
                      transform: `rotate(${angle}deg)`,
                      borderTop: "1px solid rgba(255,255,255,0.16)",
                    }}
                  />
                );
              })}

              {ROULETTE_WHEEL_SEQUENCE.map((num, idx) => {
                const step = 360 / ROULETTE_WHEEL_SEQUENCE.length;
                const angle = idx * step;
                return (
                  <div
                    key={`wheel-label-${num}`}
                    className="absolute inset-0 flex items-start justify-center pointer-events-none"
                    style={{
                      transform: `rotate(${angle}deg)`,
                    }}
                  >
                    <span
                      className="mt-[13px] text-[9px] leading-none font-black text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
                      style={{
                        transform: `rotate(-${angle}deg)`,
                      }}
                    >
                      {num}
                    </span>
                  </div>
                );
              })}

              <div className="absolute w-[56px] h-[56px] rounded-full bg-gradient-to-tr from-[#2d5a27] via-[#4ade80] to-[#15803d] border-2 border-[#166534] flex items-center justify-center z-20 shadow-md overflow-hidden">
                <div className="absolute inset-0 flex items-center justify-center bg-[#064e3b]/90">
                  <span className="text-[20px]" role="img" aria-label="Pepe">🐸</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* =========================================================
            RECENT RESULTS
        ========================================================= */}
        <div className="w-full h-8 bg-[#062318]/90 backdrop-blur-md border border-[#174f35] rounded-md px-2 flex items-center gap-1.5 overflow-hidden">
          <span className="text-[7px] font-bold text-emerald-400 uppercase tracking-wide whitespace-nowrap shrink-0">
            Recent:
          </span>
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            {history.map((num, idx) => (
              <div
                key={`${num}-${idx}`}
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-black border shrink-0 ${
                  num === 0 || num === "00"
                    ? "bg-emerald-600 border-emerald-400"
                    : isRed(num)
                      ? "bg-red-600 border-red-400"
                      : "bg-slate-900 border-slate-700"
                }`}
              >
                {num}
              </div>
            ))}
          </div>
        </div>

        {/* =========================================================
            ROUND STATUS / ALERTS
        ========================================================= */}
        {gamePhase === "spinning" && winningNumber !== null ? (
          <div className="h-8 bg-[#082a1a]/90 backdrop-blur-md border border-emerald-500/40 rounded-md px-2 flex items-center justify-center gap-2 shadow-inner">
            <span className="text-[8px] font-bold text-amber-300 uppercase animate-pulse">
              🎡 Winning Number:
            </span>
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-black border ${
                winningNumber === 0 || winningNumber === "00"
                  ? "bg-emerald-600 border-emerald-400"
                  : typeof winningNumber === "number" && isRed(winningNumber)
                    ? "bg-red-600 border-red-400"
                    : "bg-slate-900 border-slate-700"
              }`}
            >
              {winningNumber}
            </div>
          </div>
        ) : errorMsg ? (
          <div className="h-8 bg-red-950/80 border border-red-600 text-red-200 px-2 rounded-md text-[8px] font-bold flex items-center justify-center text-center">
            ⚠️ {errorMsg}
          </div>
        ) : (
          <div className="h-2" />
        )}

        {/* =========================================================
            BETTING AREA
        ========================================================= */}
        <section className="w-full bg-[#052116]/90 backdrop-blur-md border border-[#1a5b3c] rounded-lg p-2.5 shadow-md">
          <div className="flex flex-col gap-2">

            {/* Number grid & Outside bets */}
            <div className="min-w-0 flex flex-col gap-1">
              <div className="grid grid-cols-[38px_repeat(12,minmax(0,1fr))] gap-1.5">
                <div className="row-span-3 grid grid-rows-2 gap-1">
                  <button
                    onClick={() => placeBet("number", 0)}
                    className="h-full min-h-[52px] bg-emerald-700 hover:bg-emerald-600 border border-emerald-500/60 rounded-sm font-black text-[9px] text-white flex items-center justify-center relative shadow"
                  >
                    0
                    {getBet("number", 0) && (
                      <span className="absolute bottom-0.5 bg-amber-400 text-slate-950 text-[5px] px-1 rounded-full font-black">
                        ${getBet("number", 0)?.amount}
                      </span>
                    )}
                  </button>

                  <button
                    onClick={() => placeBet("number", "00")}
                    className="h-full bg-emerald-700 hover:bg-emerald-600 border border-emerald-500/60 rounded-sm font-black text-[9px] text-white flex items-center justify-center relative shadow"
                  >
                    00
                    {getBet("number", "00") && (
                      <span className="absolute bottom-0.5 bg-amber-400 text-slate-950 text-[5px] px-1 rounded-full font-black">
                        ${getBet("number", "00")?.amount}
                      </span>
                    )}
                  </button>
                </div>

                {row3Numbers.map((num) => (
                  <button
                    key={num}
                    onClick={() => placeBet("number", num)}
                    className={`h-7 rounded-sm font-black text-[9px] flex items-center justify-center relative transition border ${
                      isRed(num)
                        ? "bg-red-600 hover:bg-red-500 border-red-400"
                        : "bg-[#07100d] hover:bg-slate-900 border-slate-700"
                    }`}
                  >
                    {num}
                    {getBet("number", num) && (
                      <span className="absolute -top-1 -right-1 bg-amber-400 text-slate-950 text-[5px] px-0.5 py-px rounded-full font-black z-10 shadow">
                        ${getBet("number", num)?.amount}
                      </span>
                    )}
                  </button>
                ))}

                {row2Numbers.map((num) => (
                  <button
                    key={num}
                    onClick={() => placeBet("number", num)}
                    className={`h-7 rounded-sm font-black text-[9px] flex items-center justify-center relative transition border ${
                      isRed(num)
                        ? "bg-red-600 hover:bg-red-500 border-red-400"
                        : "bg-[#07100d] hover:bg-slate-900 border-slate-700"
                    }`}
                  >
                    {num}
                    {getBet("number", num) && (
                      <span className="absolute -top-1 -right-1 bg-amber-400 text-slate-950 text-[5px] px-0.5 py-px rounded-full font-black z-10 shadow">
                        ${getBet("number", num)?.amount}
                      </span>
                    )}
                  </button>
                ))}

                {row1Numbers.map((num) => (
                  <button
                    key={num}
                    onClick={() => placeBet("number", num)}
                    className={`h-7 rounded-sm font-black text-[9px] flex items-center justify-center relative transition border ${
                      isRed(num)
                        ? "bg-red-600 hover:bg-red-500 border-red-400"
                        : "bg-[#07100d] hover:bg-slate-900 border-slate-700"
                    }`}
                  >
                    {num}
                    {getBet("number", num) && (
                      <span className="absolute -top-1 -right-1 bg-amber-400 text-slate-950 text-[5px] px-0.5 py-px rounded-full font-black z-10 shadow">
                        ${getBet("number", num)?.amount}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Outside bets row */}
              <div className="grid grid-cols-9 gap-1">
                {([
                  ["dozen", undefined, 1, "1-12"],
                  ["dozen", undefined, 2, "13-24"],
                  ["dozen", undefined, 3, "25-36"],
                  ["even", undefined, undefined, "EVEN"],
                  ["odd", undefined, undefined, "ODD"],
                  ["red", undefined, undefined, "RED", true],
                  ["black", undefined, undefined, "BLACK", false, true],
                  ["low", undefined, undefined, "1-18"],
                  ["high", undefined, undefined, "19-36"],
                ] as const).map(([type, val, dozenIdx, label, isRedBtn, isBlackBtn]) => (
                  <button
                    key={label}
                    onClick={() => placeBet(type as BetType, val as any, dozenIdx as any)}
                    className={`h-7 rounded-sm text-[7px] font-black tracking-tight relative flex items-center justify-center transition border ${
                      isRedBtn
                        ? "bg-red-600 hover:bg-red-500 border-red-400 text-white"
                        : isBlackBtn
                          ? "bg-[#07100d] hover:bg-slate-900 border-slate-700 text-white"
                          : "bg-[#062a1b] hover:bg-[#0b3a25] border-[#1a5b3c] text-emerald-200"
                    }`}
                  >
                    {label}
                    {getBet(type as BetType, val as any, dozenIdx as any) && (
                      <span className="absolute -top-1 -right-1 bg-amber-400 text-slate-950 text-[5px] px-0.5 rounded-full font-black z-10">
                        ${getBet(type as BetType, val as any, dozenIdx as any)?.amount}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Chips and actions */}
            <div className="w-full rounded-md border border-[#174f35] bg-[#041f15] px-2 py-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 sm:gap-3">
                {[
                  {
                    val: 10000,
                    label: "$10K",
                    base: "bg-gradient-to-br from-slate-100 via-white to-slate-300",
                    edge: "border-slate-300",
                    text: "text-slate-950",
                    accent: "border-sky-500",
                  },
                  {
                    val: 25000,
                    label: "$25K",
                    base: "bg-gradient-to-br from-blue-400 via-blue-600 to-blue-800",
                    edge: "border-blue-300",
                    text: "text-black",
                    accent: "border-blue-200",
                  },
                  {
                    val: 50000,
                    label: "$50K",
                    base: "bg-gradient-to-br from-emerald-400 via-emerald-600 to-emerald-800",
                    edge: "border-emerald-300",
                    text: "text-gold",
                    accent: "border-emerald-200",
                  },
                  {
                    val: 100000,
                    label: "$100K",
                    base: "bg-gradient-to-br from-red-400 via-red-600 to-red-800",
                    edge: "border-red-300",
                    text: "text-gold",
                    accent: "border-red-200",
                  },
                ].map(({ val, label, base, edge, text: chipText, accent }) => (
                  <button
                    key={val}
                    onClick={() => setSelectedChip(val)}
                    aria-label={`Select $${val.toLocaleString()} chip`}
                    className={`group relative w-11 h-11 sm:w-12 sm:h-12 rounded-full ${base} ${chipText} ${
                      selectedChip === val
                        ? "scale-110 ring-2 ring-amber-300 ring-offset-2 ring-offset-[#041f15] shadow-[0_0_12px_rgba(251,191,36,0.55)]"
                        : "shadow-md hover:scale-105"
                    } border-[2px] ${edge} transition-all duration-150`}
                  >
                    <span className="absolute inset-0 rounded-full border-[3px] border-dashed border-black/35" />
                    <span className={`absolute inset-[4px] rounded-full border ${accent} opacity-90`} />
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="relative z-10 text-[8px] sm:text-[9px] font-black tracking-tight drop-shadow-sm">
                        {label}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
<div className="h-10 px-3 rounded bg-[#031b12] border border-[#174f35] flex items-center justify-center">
              <span className="text-[12px] font-bold text-amber-300 uppercase tracking-wide whitespace-nowrap">
                {gamePhase === "betting" ? `Betting Timer:⏳ ${timeLeft}s` : `🎡 Spinning`}
              </span>
            </div>
              <div className="flex items-center gap-2">
                <div className="text-right">
                  <span className="text-[9px] text-emerald-400 block uppercase font-bold leading-tight">Total Bet</span>
                  <span className="text-[15px] font-mono font-bold text-amber-300 block leading-tight">${totalBetAmount.toLocaleString()}</span>
                </div>

                <button
                  type="button"
                  onClick={clearBets}
                  disabled={gamePhase !== "betting" || timeLeft <= 2 || bets.length === 0}
                  className="h-8 px-2.5 rounded border border-red-500/50 bg-red-950/70 text-red-300 text-[7px] font-black uppercase hover:bg-red-900 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition"
                >
                  Clear Bets
                </button>
              </div>
            </div>
        
            {/* BACCARAT-STYLE ROAD MAP & STATISTICS TRACKER */}
            <RouletteRoadMap history={history} isRed={isRed} />

            {/* Ticker footer */}
            <section
              className="w-full h-7 overflow-hidden rounded border border-[#174f35] bg-[#041f15] flex items-center px-3"
              aria-live="polite"
            >
              <div className="w-full flex items-center justify-between text-[7px] sm:text-[8px] font-black uppercase tracking-wide text-emerald-200">
                <span>🕒 GMT {gmtTime}</span>
                <span>★★★★★</span>
                <span className="truncate px-2">{tickerMessage}</span>
              </div>
            </section>
          </div>
        </section>

      </div>

      {/* Modals */}
      {showPayoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-md bg-[#143220] rounded-2xl border border-emerald-500/40 p-5 shadow-2xl">
            <button onClick={() => setShowPayoutModal(false)} className="absolute top-4 right-4 text-emerald-300 hover:text-white font-bold text-sm bg-[#1b432c] w-8 h-8 rounded-full flex items-center justify-center">✕</button>
            <h2 className="text-base font-black text-amber-400 mb-3 uppercase tracking-wider">📋 Roulette Payout Table</h2>
            <div className="space-y-2 text-xs font-medium text-emerald-100">
              {([["Straight Up (Number)", "32 : 1"], ["Dozens (1-12, etc.)", "2 : 1"], ["Columns (2:1)", "2 : 1"], ["Low / High (1-18 / 19-36)", "1 : 1"], ["Red / Black", "1 : 1"], ["Even / Odd", "1 : 1"]] as const).map(([name, payout]) => (
                <div key={name} className="flex justify-between p-2 bg-[#1b432c]/60 rounded-lg border border-[#2b5a3d]">
                  <span>{name}</span>
                  <span className="font-mono font-bold text-amber-300">{payout}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}