"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";

const GAME_SETTINGS = {
  defaultBet: 20,
  presetBets: [100, 200, 500, 1000, 5000, 10000],
  autoSpinOptions: [10, 30, 50, 100, 500, 1000],
  featureBuyMultiplier: 75,
  superBuyMultiplier: 200,
  symbolPathPrefix: "/images/token/",
  images: {
    spin: "/images/tokenrush/spin.png",
    autoSpin: "/images/tokenrush/autospin.png",
    buyBonus: "/images/tokenrush/buybonus.png",
    pageBg: "/images/tokenrush/yehey.png",
    cardBg: "/images/tokenrush/pagebg.png",
    gridBg: "/images/tokenrush/grid.png",
    yeheyBg: "/images/tokenrush/yehey.png",
  
  },
};

const img = GAME_SETTINGS.images;

export interface SymbolCell {
  id: string;
  symbol: string;
  isGold: boolean;
  multiplier: number;
  isWild?: boolean;
  isScatter?: boolean;
}

export interface WinningLineInfo {
  lineIndex: number;
  coords: { col: number; row: number }[];
  color: string;
}

export interface WinTier {
  name: string;
  minMult: number;
  maxMult: number;
  color: string;
  glow: string;
}

interface FloatingParticle {
  id: number;
  col: number;
  row: number;
  text: string;
}

const SPEED_CONFIG: Record<
  number,
  { label: string; spinDelay: number; cascadeDelay: number; scatterDelay: number; reelStagger: number }
> = {
  1: { label: "⚡", spinDelay: 1200, cascadeDelay: 900, scatterDelay: 1500, reelStagger: 200 },
  2: { label: "⚡⚡ ", spinDelay: 800, cascadeDelay: 600, scatterDelay: 1200, reelStagger: 150 },
  3: { label: "⚡⚡⚡", spinDelay: 400, cascadeDelay: 300, scatterDelay: 600, reelStagger: 80 },
  4: { label: "⚡⚡⚡⚡ ", spinDelay: 150, cascadeDelay: 100, scatterDelay: 200, reelStagger: 30 },
};

const WIN_TIERS: WinTier[] = [
  { name: "MAX WIN", minMult: 5000, maxMult: Infinity, color: "from-red-600 via-amber-400 to-yellow-300", glow: "shadow-red-500/80" },
  { name: "Jackpot Win", minMult: 2500, maxMult: 4999.99, color: "from-purple-600 via-pink-500 to-amber-400", glow: "shadow-purple-500/80" },
  { name: "Insane Win", minMult: 1000, maxMult: 2499.99, color: "from-fuchsia-600 to-cyan-400", glow: "shadow-fuchsia-500/70" },
  { name: "Massive Win", minMult: 500, maxMult: 999.99, color: "from-cyan-500 to-blue-600", glow: "shadow-cyan-500/60" },
  { name: "Legendary Win", minMult: 250, maxMult: 499.99, color: "from-emerald-400 to-teal-600", glow: "shadow-emerald-500/60" },
  { name: "Epic Win", minMult: 100, maxMult: 249.99, color: "from-amber-400 to-orange-600", glow: "shadow-amber-500/60" },
  { name: "Mega Win", minMult: 50, maxMult: 99.99, color: "from-yellow-400 to-amber-500", glow: "shadow-yellow-500/50" },
  { name: "Big Win", minMult: 25, maxMult: 49.99, color: "from-blue-400 to-indigo-600", glow: "shadow-blue-500/50" },
  { name: "Nice Win", minMult: 10, maxMult: 24.99, color: "from-teal-400 to-emerald-500", glow: "shadow-teal-500/40" },
];

const SYMBOL_LIST = [
  "bonk.png",
  "chillguy.png",
  "doge.png",
  "fartcoin.png",
  "pengu.png",
  "pepe.png",
  "troll.png",
  "wif.png",
  "wojak.png",
];

const getSymbolPath = (filename: string) => `${GAME_SETTINGS.symbolPathPrefix}${filename}`;

class TokenRushAudio {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private bgInterval: NodeJS.Timeout | null = null;

  private getContext() {
    if (!this.ctx && typeof window !== "undefined") {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
    return this.ctx;
  }

  playInstantHook() {
    const ctx = this.getContext();
    if (!ctx || this.isMuted) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(2400, ctx.currentTime + 0.05);

    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.05);
  }

  playHyperCascadeHook() {
    const ctx = this.getContext();
    if (!ctx || this.isMuted) return;

    const freqs = [1046.5, 1174.66, 1318.51, 1567.98, 1760.0];
    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const startTime = ctx.currentTime + idx * 0.02;

      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.12, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.06);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 0.06);
    });
  }

  playSpin(speedLevel: number = 2) {
    const ctx = this.getContext();
    if (!ctx || this.isMuted) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const duration = 0.2 / speedLevel;

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(180, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(45, ctx.currentTime + duration);

    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  playScatterHit(scatterIndex: number = 1) {
    const ctx = this.getContext();
    if (!ctx || this.isMuted) return;

    const baseFreq = 523.25 * Math.pow(1.25, scatterIndex);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(baseFreq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, ctx.currentTime + 0.25);

    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  }

  playTease() {
    const ctx = this.getContext();
    if (!ctx || this.isMuted) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(300, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.5);

    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.5);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  }

  playMultiplierBoost(multValue: number) {
    const ctx = this.getContext();
    if (!ctx || this.isMuted) return;

    const notes = [261.63, 329.63, 392.0, 523.25, 659.25, 783.99];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const startTime = ctx.currentTime + idx * 0.04;

      osc.type = "square";
      osc.frequency.setValueAtTime(freq * Math.min(2, 1 + multValue / 50), startTime);

      gain.gain.setValueAtTime(0.08, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 0.12);
    });
  }

  playWinSound(multiplier: number) {
    const ctx = this.getContext();
    if (!ctx || this.isMuted) return;

    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const startTime = ctx.currentTime + i * 0.08;

      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.15, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.2);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 0.2);
    });
  }

  startBackgroundMusic(isFreeSpins: boolean = false) {
    this.stopBackgroundMusic();
    const ctx = this.getContext();
    if (!ctx) return;

    const arpeggio = isFreeSpins
      ? [440, 523.25, 659.25, 783.99, 880, 1046.5]
      : [261.63, 329.63, 392.0, 523.25];

    let noteIdx = 0;
    const intervalMs = isFreeSpins ? 150 : 250;

    this.bgInterval = setInterval(() => {
      if (this.isMuted || !this.ctx) return;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(arpeggio[noteIdx], this.ctx.currentTime);

      gain.gain.setValueAtTime(0.015, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.18);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.18);

      noteIdx = (noteIdx + 1) % arpeggio.length;
    }, intervalMs);
  }

  stopBackgroundMusic() {
    if (this.bgInterval) {
      clearInterval(this.bgInterval);
      this.bgInterval = null;
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.isMuted) this.stopBackgroundMusic();
    return this.isMuted;
  }
}

const soundFx = new TokenRushAudio();

export default function TokenRushPage() {
  const { publicKey, connected } = useWallet();

  const [showBuyBonusConfirm, setShowBuyBonusConfirm] = useState<boolean>(false);
  const [buyBonusType, setBuyBonusType] = useState<"standard" | "super">("standard");

  const [isMounted, setIsMounted] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [balance, setBalance] = useState<number>(0);
  const [betAmount, setBetAmount] = useState<number>(GAME_SETTINGS.defaultBet);
  const [speedLevel, setSpeedLevel] = useState<number>(2);

  const gridPaddingX = 6.0;
  const gridPaddingY = 6.0;
  const gridAspectRatio = "3/2";
  const reelGap = 0.4;

  const titleText = "T O K E N  R U S H";
  const titleFontSize = 26;
  const titleColor = "#fbbf24";
  const titleFontFamily = "'Cinzel', serif";

  const multLabelText = "MULTIPLIER";
  const multiplierFontSize = 46;
  const multiplierColor = "#f505e5";

  const balanceLabelText = "BALANCE";
  const betLabelText = "BET";
  const winLabelText = "SPIN WIN";

  const statusFontSize = 13;
  const statusColor = "#34d399";

  const footerMsgText = "GOODLUCK!";
  const speedLabelText = "SPEED:";

  const [lastWin, setLastWin] = useState<number>(0);
  const [roundMultiplier, setRoundMultiplier] = useState<number>(0);
  const [persistentMultiplier, setPersistentMultiplier] = useState<number>(0);
  const [statusMsg, setStatusMsg] = useState<string>("Connect Wallet to Spin!");
  const [warningMsg, setWarningMsg] = useState<string | null>(null);
  const [isSpinning, setIsSpinning] = useState<boolean>(false);
  const [reelsSpinning, setReelsSpinning] = useState<boolean[]>([false, false, false, false, false]);
  const [teaseReels, setTeaseReels] = useState<boolean[]>([false, false, false, false, false]);
  const [activeWinningLines, setActiveWinningLines] = useState<WinningLineInfo[]>([]);
  const [winningCellKeys, setWinningCellKeys] = useState<Set<string>>(new Set());
  const [freeSpins, setFreeSpins] = useState<number>(0);
  const [totalBonusWin, setTotalBonusWin] = useState<number>(0);
  const [showBonusSummary, setShowBonusSummary] = useState<boolean>(false);
  const [showScatterOverlay, setShowScatterOverlay] = useState<boolean>(false);
  const [pendingAwardedSpins, setPendingAwardedSpins] = useState<number>(0);
  const [activeWinTier, setActiveWinTier] = useState<{ tier: WinTier; amount: number; multiplier: number } | null>(null);
  const [autoSpinsRemaining, setAutoSpinsRemaining] = useState<number>(0);
  const [showAutoMenu, setShowAutoMenu] = useState<boolean>(false);

  const [multPunched, setMultPunched] = useState<boolean>(false);
  const [goldFlash, setGoldFlash] = useState<boolean>(false);
  const [floatingParticles, setFloatingParticles] = useState<FloatingParticle[]>([]);

  const featureBuyCost = betAmount * GAME_SETTINGS.featureBuyMultiplier;
  const superBuyCost = betAmount * GAME_SETTINGS.superBuyMultiplier;
  const isBetLocked = isSpinning || freeSpins > 0 || autoSpinsRemaining > 0 || showScatterOverlay || showBonusSummary;

  const autoSpinsRef = useRef<number>(autoSpinsRemaining);
  const freeSpinsRef = useRef<number>(freeSpins);
  const balanceRef = useRef<number>(balance);
  const betAmountRef = useRef<number>(betAmount);
  const isSpinningRef = useRef<boolean>(isSpinning);
  const speedLevelRef = useRef<number>(speedLevel);
  const activeWinTierRef = useRef(activeWinTier);
  const showScatterOverlayRef = useRef(showScatterOverlay);
  const persistentMultiplierRef = useRef<number>(persistentMultiplier);

  useEffect(() => { autoSpinsRef.current = autoSpinsRemaining; }, [autoSpinsRemaining]);
  useEffect(() => { freeSpinsRef.current = freeSpins; }, [freeSpins]);
  useEffect(() => { balanceRef.current = balance; }, [balance]);
  useEffect(() => { betAmountRef.current = betAmount; }, [betAmount]);
  useEffect(() => { isSpinningRef.current = isSpinning; }, [isSpinning]);
  useEffect(() => { speedLevelRef.current = speedLevel; }, [speedLevel]);
  useEffect(() => { activeWinTierRef.current = activeWinTier; }, [activeWinTier]);
  useEffect(() => { showScatterOverlayRef.current = showScatterOverlay; }, [showScatterOverlay]);
  useEffect(() => { persistentMultiplierRef.current = persistentMultiplier; }, [persistentMultiplier]);

  const fetchServerBalance = useCallback(async () => {
    if (!publicKey || !connected) {
      setBalance(0);
      return;
    }

    try {
      const res = await fetch(`/api/balance?walletAddress=${publicKey.toBase58()}`);
      const data = await res.json();
      if (data.success) {
        setBalance(data.balance);
      }
    } catch (err) {
      console.error("Error fetching vault balance:", err);
    }
  }, [publicKey, connected]);

  // --- RESTORE GAME STATE FUNCTION ---
  const restoreGameState = useCallback(async () => {
    if (!publicKey || !connected) return;

    try {
      const res = await fetch(`/api/spin/tokenrush?walletAddress=${publicKey.toBase58()}`);
      const data = await res.json();

      if (data.success) {
        setBalance(data.balance);

        // ONLY restore Bet, Multipliers, and Win Totals if Free Spins are actually active!
        if (data.freeSpinsLeft > 0) {
          setFreeSpins(data.freeSpinsLeft);
          freeSpinsRef.current = data.freeSpinsLeft;

          setPersistentMultiplier(data.currentMultiplier || 1);
          persistentMultiplierRef.current = data.currentMultiplier || 1;

          // 1. Restore Bet Amount INSIDE the free spin block
          if (data.betAmount) {
            setBetAmount(data.betAmount);
            betAmountRef.current = data.betAmount;
          }

          // 2. Restore Accumulated Bonus Win
          if (data.totalBonusWin !== undefined && data.totalBonusWin !== null) {
            setTotalBonusWin(Number(data.totalBonusWin));
          }

          setStatusMsg(`Welcome back! You have ${data.freeSpinsLeft} Free Spins remaining.`);
        }
      }
    } catch (err) {
      console.error("Failed to restore game session:", err);
    }
  }, [publicKey, connected]);
  // --- CONNECTED TRIGGER EFFECT ---
  useEffect(() => {
    setIsMounted(true);
    if (connected) {
      fetchServerBalance();
      restoreGameState();
      setStatusMsg("Tap SPIN to start!");
    } else {
      setStatusMsg("Connect Wallet to Spin!");
    }
  }, [connected, fetchServerBalance, restoreGameState]);

  useEffect(() => {
    if (!isSpinning && (autoSpinsRemaining > 0 || freeSpins > 0) && !activeWinTier && !showScatterOverlay && !showBonusSummary) {
      const timer = setTimeout(() => {
        if (!isSpinningRef.current && !showScatterOverlayRef.current) {
          if (autoSpinsRemaining > 0 && freeSpins === 0) {
            setAutoSpinsRemaining((prev) => {
              const nextVal = Math.max(0, prev - 1);
              autoSpinsRef.current = nextVal;
              return nextVal;
            });
          }
          executeSpin(null);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isSpinning, autoSpinsRemaining, freeSpins, activeWinTier, showScatterOverlay, showBonusSummary]);

  useEffect(() => {
    if (activeWinTier && (autoSpinsRemaining > 0 || freeSpins > 0)) {
      const displayDuration = speedLevel === 4 ? 800 : 2200;
      const timer = setTimeout(() => { handleCollectWin(); }, displayDuration);
      return () => clearTimeout(timer);
    }
  }, [activeWinTier, autoSpinsRemaining, freeSpins, speedLevel]);

  useEffect(() => {
    if (balance < betAmount && freeSpins === 0 && connected) setWarningMsg("⚠️ Insufficient Vault Balance!");
    else setWarningMsg(null);
  }, [balance, betAmount, freeSpins, connected]);

  const handleToggleAudio = () => {
    const muted = soundFx.toggleMute();
    setIsMuted(muted);
    if (!muted) {
      soundFx.startBackgroundMusic(freeSpins > 0);
    }
  };

  const handleDecreaseBet = () => {
    if (isBetLocked || freeSpins > 0) return;
    const currentIndex = GAME_SETTINGS.presetBets.indexOf(betAmount);
    if (currentIndex > 0) setBetAmount(GAME_SETTINGS.presetBets[currentIndex - 1]);
  };

  const handleIncreaseBet = () => {
    if (isBetLocked || freeSpins > 0) return;
    const currentIndex = GAME_SETTINGS.presetBets.indexOf(betAmount);
    if (currentIndex < GAME_SETTINGS.presetBets.length - 1) setBetAmount(GAME_SETTINGS.presetBets[currentIndex + 1]);
  };

  const handleDecreaseSpeed = () => setSpeedLevel((prev) => Math.max(1, prev - 1));
  const handleIncreaseSpeed = () => setSpeedLevel((prev) => Math.min(4, prev + 1));

  const [grid, setGrid] = useState<SymbolCell[][]>(() =>
    Array(5).fill(null).map((_, col) => Array(3).fill(null).map((_, row) => ({ id: `ssr-${col}-${row}`, symbol: "wojak.png", isGold: false, multiplier: 0, isWild: false, isScatter: false })))
  );

  const triggerMultiplierPunch = useCallback(() => {
    setMultPunched(true);
    setGoldFlash(true);
    setTimeout(() => setMultPunched(false), 400);
    setTimeout(() => setGoldFlash(false), 600);
  }, []);

  const spawnFloatingParticle = (col: number, row: number, text: string) => {
    const newP: FloatingParticle = { id: Date.now() + Math.random(), col, row, text };
    setFloatingParticles((prev) => [...prev, newP]);
    setTimeout(() => {
      setFloatingParticles((prev) => prev.filter((p) => p.id !== newP.id));
    }, 1000);
  };

  const startAutoSpin = (count: number) => {
    setShowAutoMenu(false);
    setAutoSpinsRemaining(count);
    autoSpinsRef.current = count;
    if (!isSpinningRef.current && !showScatterOverlayRef.current) executeSpin(null);
  };

  const stopAutoSpin = () => {
    setAutoSpinsRemaining(0);
    autoSpinsRef.current = 0;
    setStatusMsg("Auto spin stopped.");
  };

  const handleCollectWin = () => {
    setActiveWinTier(null);
    activeWinTierRef.current = null;
    if (!showScatterOverlayRef.current && (freeSpinsRef.current > 0 || (autoSpinsRef.current > 0 && balanceRef.current >= betAmountRef.current))) {
      executeSpin(null);
    }
  };

  const handleStartFreeSpins = () => {
    setShowScatterOverlay(false);
    showScatterOverlayRef.current = false;
    soundFx.startBackgroundMusic(true);
    executeSpin(null);
  };

  const handleClaimBonusWin = () => {
    setShowBonusSummary(false);
    setTotalBonusWin(0);
    soundFx.startBackgroundMusic(false);
    setStatusMsg("Bonus completed! Spin to play again.");
  };

  const triggerBonusBuy = (type: "standard" | "super") => {
    setShowBuyBonusConfirm(false);
    executeSpin(type);
  };

  const executeSpin = async (buyType?: "standard" | "super" | null) => {
    if (isSpinningRef.current || showScatterOverlayRef.current || showBonusSummary || !connected || !publicKey) return;

    if (activeWinTier) { setActiveWinTier(null); activeWinTierRef.current = null; }

    soundFx.playInstantHook();

    const speedConfig = SPEED_CONFIG[speedLevelRef.current];

    setIsSpinning(true);
    isSpinningRef.current = true;
    soundFx.playSpin(speedLevelRef.current);

    setLastWin(0);
    setWarningMsg(null);
    setActiveWinningLines([]);
    setWinningCellKeys(new Set());
    setReelsSpinning([true, true, true, true, true]);
    setTeaseReels([false, false, false, false, false]);

    const isCurrentFreeSpin = freeSpinsRef.current > 0;

    if (!isCurrentFreeSpin && !buyType) {
      setRoundMultiplier(0);
      setPersistentMultiplier(0);
      persistentMultiplierRef.current = 0;
      setTotalBonusWin(0);
    }

    let sendingMultiplier = persistentMultiplierRef.current;

    try {
      const response = await fetch("/api/spin/tokenrush", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: publicKey.toBase58(),
          betAmount: betAmountRef.current,
          buyType: buyType || null,
          isFreeSpin: isCurrentFreeSpin,
          currentMultiplier: sendingMultiplier,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        setWarningMsg(`⚠️ ${data.error || "Spin request failed"}`);
        setIsSpinning(false);
        isSpinningRef.current = false;
        setReelsSpinning([false, false, false, false, false]);
        stopAutoSpin();
        return;
      }

      setBalance(data.newBalance);

      let scatterCountSoFar = 0;
      for (let col = 0; col < 5; col++) {
        if (scatterCountSoFar >= 2 && col >= 2) {
          setTeaseReels((prev) => {
            const next = [...prev];
            next[col] = true;
            return next;
          });
          soundFx.playTease();
          await new Promise((resolve) => setTimeout(resolve, speedConfig.scatterDelay));
        } else {
          await new Promise((resolve) => setTimeout(resolve, speedConfig.reelStagger));
        }

        setGrid((prevGrid) => {
          const updated = [...prevGrid];
          updated[col] = data.grid[col];
          return updated;
        });

        data.grid[col].forEach((cell: SymbolCell, rowIdx: number) => {
          if (cell.isGold && cell.multiplier > 0) {
            spawnFloatingParticle(col, rowIdx, `+x${cell.multiplier}`);
          }
        });

        const colScatters = data.grid[col].filter((c: SymbolCell) => c.isScatter).length;
        if (colScatters > 0) {
          scatterCountSoFar += colScatters;
          soundFx.playScatterHit(scatterCountSoFar);
        }

        setReelsSpinning((prev) => {
          const next = [...prev];
          next[col] = false;
          return next;
        });
      }

      await new Promise((resolve) => setTimeout(resolve, speedConfig.spinDelay / 2));

      const cascadeSteps = data.cascadeSteps || [];
      
      for (let stepIdx = 0; stepIdx < cascadeSteps.length; stepIdx++) {
        const step = cascadeSteps[stepIdx];
        
        setGrid(step.grid);

        const rawLines = step.winningLines || [];
        setActiveWinningLines(rawLines);

        const keys = new Set<string>();
        rawLines.forEach((line: WinningLineInfo) => {
          line.coords.forEach((coord) => keys.add(`${coord.col}-${coord.row}`));
        });
        setWinningCellKeys(keys);

        if (rawLines.length > 0) {
          soundFx.playHyperCascadeHook();
          await new Promise((resolve) => setTimeout(resolve, speedConfig.cascadeDelay));
        }
      }

      setActiveWinningLines([]);
      setWinningCellKeys(new Set());

      const returnedMult = data.finalMultiplier ?? 0;
      const effectiveMultiplier = (isCurrentFreeSpin || buyType === "super") 
        ? Math.max(persistentMultiplierRef.current, returnedMult) 
        : returnedMult;

      if (effectiveMultiplier > persistentMultiplierRef.current) {
        soundFx.playMultiplierBoost(effectiveMultiplier);
        triggerMultiplierPunch();
      }

      setRoundMultiplier(effectiveMultiplier);
      if (isCurrentFreeSpin || buyType === "super") {
        setPersistentMultiplier(effectiveMultiplier);
        persistentMultiplierRef.current = effectiveMultiplier;
      }

      if (data.totalPayout > 0) {
        const betMultiplier = data.totalPayout / betAmountRef.current;
        
        if (speedLevelRef.current < 3 && betMultiplier < 10) {
          soundFx.playWinSound(betMultiplier);
        }

        setLastWin(data.totalPayout);

        if (isCurrentFreeSpin) {
          setTotalBonusWin((prev) => prev + data.totalPayout);
        }

        const matchedTier = WIN_TIERS.find((t) => betMultiplier >= t.minMult && betMultiplier <= t.maxMult);
        if (matchedTier) {
          const tierData = { tier: matchedTier, amount: data.totalPayout, multiplier: betMultiplier };
          setActiveWinTier(tierData);
          activeWinTierRef.current = tierData;
        }
        setStatusMsg(`TOTAL WIN: $${data.totalPayout.toFixed(2)} `);
      } else {
        setStatusMsg("Try Again!");
      }

      let remainingSpins = freeSpinsRef.current;
      if (isCurrentFreeSpin) {
        remainingSpins = Math.max(0, remainingSpins - 1);
        setFreeSpins(remainingSpins);
        freeSpinsRef.current = remainingSpins;
      }

      if (data.awardedFreeSpins > 0) {
        setPendingAwardedSpins(data.awardedFreeSpins);
        const updatedSpins = remainingSpins + data.awardedFreeSpins;
        setFreeSpins(updatedSpins);
        freeSpinsRef.current = updatedSpins;
        setShowScatterOverlay(true);
        showScatterOverlayRef.current = true;
      }

      if (isCurrentFreeSpin && freeSpinsRef.current === 0 && data.awardedFreeSpins === 0) {
        setPersistentMultiplier(0);
        persistentMultiplierRef.current = 0;
        setShowBonusSummary(true);
      }

    } catch (err: any) {
      console.error("Spin error:", err);
      setWarningMsg("⚠️ Communication error with game server");
      stopAutoSpin();
    } finally {
      setIsSpinning(false);
      isSpinningRef.current = false;
    }
  };

  const getCellCenterCoordinates = (col: number, row: number) => {
    const x = gridPaddingX + (col + 0.5) * ((100 - gridPaddingX * 2) / 5);
    const y = gridPaddingY + (row + 0.5) * ((100 - gridPaddingY * 2) / 3);
    return { x, y };
  };

  const currentMultValue = freeSpins > 0 ? persistentMultiplier : roundMultiplier;
  const displayMultText = currentMultValue > 0 ? currentMultValue : 0;

  return (
    <div
      className="flex flex-col items-center justify-start min-h-[100dvh] bg-slate-950 text-white p-2 sm:p-4 select-none relative overflow-x-hidden bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: img.pageBg ? `url(${img.pageBg})` : undefined }}
    >
      <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px] pointer-events-none" />

      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Inter:wght@400;700;900&family=Roboto+Mono:wght@700&display=swap');

        @keyframes verticalRollDownward {
          0% { transform: translateY(-50%); }
          100% { transform: translateY(0%); }
        }

        .animate-vertical-roll-downward {
          animation: verticalRollDownward 0.25s linear infinite;
        }

        .slot-viewport-mask {
          mask-image: linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%);
          -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%);
        }

        @keyframes dropIn {
          0% {
            transform: translateY(-120%);
            opacity: 0;
          }
          100% {
            transform: translateY(0);
            opacity: 1;
          }
        }

        .animate-cascade-drop {
          animation: dropIn 0.35s cubic-bezier(0.25, 1, 0.5, 1) forwards;
        }

        @keyframes goldShimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .animate-gold-shimmer {
          background: linear-gradient(90deg, rgba(245,158,11,0.15) 0%, rgba(254,240,138,0.5) 50%, rgba(245,158,11,0.15) 100%);
          background-size: 200% 100%;
          animation: goldShimmer 2s infinite linear;
        }

        @keyframes floatUpFade {
          0% { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 0; transform: translateY(-40px) scale(1.4); }
        }
        .animate-float-up {
          animation: floatUpFade 1s ease-out forwards;
        }

        @keyframes teaseGlow {
          0%, 100% { box-shadow: inset 0 0 15px #f59e0b, 0 0 15px #f59e0b; }
          50% { box-shadow: inset 0 0 30px #fef08a, 0 0 30px #fef08a; }
        }
        .animate-tease-pulse {
          animation: teaseGlow 0.6s infinite ease-in-out;
        }
      `}</style>

      <div
        className={`bg-slate-900 border rounded-2xl sm:rounded-3xl shadow-2xl w-full max-w-[500px] text-center relative overflow-hidden p-2.5 sm:p-4 bg-cover bg-center bg-no-repeat z-10 transition-all duration-300 my-auto ${
          goldFlash ? "border-amber-400 shadow-[0_0_35px_rgba(245,158,11,0.6)]" : "border-slate-800"
        }`}
        style={{
          backgroundImage: img.cardBg ? `url(${img.cardBg})` : undefined,
        }}
      >
     {/* HEADER BAR */}
<div className="flex items-center justify-between mb-1">
  <Link
    href="/"
    className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-950/80 hover:bg-slate-800/90 text-slate-300 hover:text-amber-400 text-xs font-bold rounded-xl border border-slate-700/60 shadow-md transition-all active:scale-95"
  >
    ← Lobby
  </Link>

  <div className="flex items-center gap-1.5">
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

    {/* AUDIO */}
    <button
      onClick={handleToggleAudio}
      className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-950/80 hover:bg-slate-800/90 text-slate-300 hover:text-amber-400 text-xs font-bold rounded-xl border border-slate-700/60 shadow-md transition-all active:scale-95"
    >
      {isMuted ? "🔇 Muted" : "🔊 Audio ON"}
    </button>
  </div>
</div>

        {/* BUY BONUS OVERLAY */}
        {showBuyBonusConfirm && (
          <div className="absolute inset-0 z-50 flex items-center justify-center p-3 bg-slate-950/85 backdrop-blur-md animate-in fade-in zoom-in-95">
            <div className="bg-slate-900 border border-amber-500/50 p-4 rounded-2xl shadow-2xl max-w-xs w-full text-center flex flex-col items-center gap-2.5">
              <div className="text-amber-400 font-extrabold text-sm uppercase tracking-wider">
                Select Feature Bonus
              </div>

              <div className="flex gap-2 w-full my-1">
                <button
                  onClick={() => setBuyBonusType("standard")}
                  className={`flex-1 p-2 rounded-xl border font-bold text-xs ${buyBonusType === "standard" ? "bg-amber-500/20 border-amber-400 text-amber-300" : "bg-slate-800 border-slate-700 text-slate-400"}`}
                >
                  Standard (75x)
                  <div className="text-[10px] text-slate-300 font-mono">${featureBuyCost.toFixed(0)}</div>
                </button>

                <button
                  onClick={() => setBuyBonusType("super")}
                  className={`flex-1 p-2 rounded-xl border font-bold text-xs ${buyBonusType === "super" ? "bg-purple-500/20 border-purple-400 text-purple-300" : "bg-slate-800 border-slate-700 text-slate-400"}`}
                >
                  SUPER (200x)
                  <div className="text-[10px] text-purple-200 font-mono">${superBuyCost.toFixed(0)}</div>
                </button>
              </div>

              <div className="flex items-center justify-center gap-2 w-full mt-1">
                <button
                  onClick={() => setShowBuyBonusConfirm(false)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2 px-3 rounded-xl transition text-xs border border-slate-700 active:scale-95"
                >
                  Cancel
                </button>
                <button
                  onClick={() => triggerBonusBuy(buyBonusType)}
                  className="flex-1 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold py-2 px-3 rounded-xl transition text-xs shadow-lg shadow-amber-500/20 active:scale-95"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}

        {/* FREE SPINS TRIGGER OVERLAY */}
        {showScatterOverlay && (
          <div 
            className="absolute inset-0 z-50 flex flex-col items-center justify-center p-4 animate-in fade-in zoom-in-95 overflow-hidden bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: `url(${img.yeheyBg})` }}
          >
            <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" />
            <div className="relative z-10 flex flex-col items-center">
              <div className="font-black bg-gradient-to-r from-yellow-400 via-amber-300 to-amber-500 bg-clip-text text-transparent uppercase tracking-wider text-xl sm:text-3xl mb-1 drop-shadow-lg animate-pulse">
                CONGRATULATIONS!
              </div>

              <div className="text-slate-200 font-bold text-xs mb-2">
                YOU WON
              </div>

              <div className="font-black text-amber-400 text-2xl sm:text-4xl mb-5 drop-shadow-xl tracking-tight">
                {pendingAwardedSpins} FREE SPINS
              </div>

              <button
                onClick={handleStartFreeSpins}
                className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black px-6 py-2.5 rounded-xl transition active:scale-95 shadow-xl shadow-emerald-500/30 uppercase tracking-wide text-xs"
              >
                START FREE SPINS
              </button>
            </div>
          </div>
        )}

        {/* END OF BONUS TOTAL WIN OVERLAY */}
        {showBonusSummary && (
          <div 
            className="absolute inset-0 z-50 flex flex-col items-center justify-center p-4 animate-in fade-in zoom-in-95 overflow-hidden bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: `url(${img.yeheyBg})` }}
          >
            <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-md" />
            <div className="relative z-10 flex flex-col items-center">
              <div className="font-black bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 bg-clip-text text-transparent uppercase tracking-wider text-xl sm:text-3xl mb-1 drop-shadow-lg">
                FEATURE COMPLETED!
              </div>

              <div className="text-slate-300 font-extrabold text-[11px] mb-2 uppercase tracking-widest">
                TOTAL FEATURE WIN
              </div>

              <div className="font-black text-emerald-400 text-3xl sm:text-5xl mb-5 drop-shadow-2xl tracking-tight">
                ${totalBonusWin.toFixed(2)}
              </div>

              <button
                onClick={handleClaimBonusWin}
                className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-8 py-3 rounded-xl transition active:scale-95 shadow-xl shadow-amber-500/30 uppercase tracking-wide text-xs"
              >
                CLAIM WIN
              </button>
            </div>
          </div>
        )}

        {/* WIN TIER OVERLAY */}
        {activeWinTier && (
          <div 
            className="absolute inset-0 z-40 flex flex-col items-center justify-center p-4 animate-in fade-in zoom-in-95 overflow-hidden bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: `url(${img.yeheyBg})` }}
          >
            <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" />
            <div className="relative z-10 flex flex-col items-center">
              <div className={`font-black bg-gradient-to-r ${activeWinTier.tier.color} bg-clip-text text-transparent uppercase tracking-wider text-xl sm:text-3xl mb-1 drop-shadow-lg ${activeWinTier.tier.glow}`}>
                {activeWinTier.tier.name}!
              </div>

              <div className="font-black text-white text-2xl sm:text-4xl mb-5 tracking-tight drop-shadow-md">
                ${activeWinTier.amount.toFixed(2)}
              </div>

              <button
                onClick={handleCollectWin}
                className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-6 py-2 rounded-xl transition active:scale-95 shadow-lg shadow-amber-500/20 text-xs"
              >
                COLLECT
              </button>
            </div>
          </div>
        )}

        {/* Title Display */}
        <h1
          className="font-extrabold tracking-wider mb-0.5 leading-none"
          style={{
            fontSize: `${titleFontSize}px`,
            color: titleColor,
            fontFamily: titleFontFamily,
          }}
        >
          {titleText}
        </h1>

        {/* Multiplier Display with Punch-In Effect */}
        <div className="flex flex-col items-center justify-center text-center pt-1 mb-1">
          <div className="uppercase font-semibold tracking-widest text-[9px] text-white">
            {multLabelText}
          </div>
          <div
            className={`font-black flex items-center justify-center leading-none transition-transform duration-200 ${
              multPunched ? "scale-125 drop-shadow-[0_0_25px_rgba(250,204,21,1)]" : "scale-100 drop-shadow-[0_0_12px_rgba(245,5,5,0.8)]"
            }`}
            style={{
              fontSize: `${multiplierFontSize}px`,
              color: multiplierColor,
            }}
          >
            <span className="text-[0.55em] mr-0.5 inline-block">x</span>
            <span>{displayMultText}</span>
          </div>
        </div>

        {/* Grid Background & Slot Container */}
        <div
          className={`relative w-full rounded-xl overflow-hidden slot-viewport-mask shadow-xl mx-auto mb-2.5 bg-cover bg-center bg-no-repeat border transition-all duration-300 ${
            goldFlash ? "border-amber-400 shadow-amber-500/50 ring-2 ring-amber-400" : "border-amber-500/30"
          }`}
          style={{
            backgroundImage: `url(${img.gridBg})`,
            aspectRatio: gridAspectRatio,
            maxHeight: "340px",
          }}
        >
          {freeSpins > 0 && (
            <div className="absolute top-1.5 left-1/2 -translate-x-1/2 z-30 bg-purple-600/90 border border-purple-400 text-white font-black px-3 py-0.5 rounded-full shadow-lg text-[10px] animate-bounce tracking-wide backdrop-blur-sm">
              FREE SPINS: {freeSpins}
            </div>
          )}

          {/* FLOATING MULTIPLIER PARTICLES */}
          {floatingParticles.map((p) => {
            const { x, y } = getCellCenterCoordinates(p.col, p.row);
            return (
              <div
                key={p.id}
                className="absolute z-40 font-black text-amber-300 text-xs sm:text-sm drop-shadow-[0_0_8px_rgba(0,0,0,1)] pointer-events-none animate-float-up"
                style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" }}
              >
                {p.text}
              </div>
            );
          })}

          {/* PAYLINE SVG LAYER */}
          {activeWinningLines.length > 0 && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none z-20" viewBox="0 0 100 100" preserveAspectRatio="none">
              {activeWinningLines.map((lineInfo) => {
                const points = lineInfo.coords.map((coord) => {
                  const { x, y } = getCellCenterCoordinates(coord.col, coord.row);
                  return `${x},${y}`;
                }).join(" ");

                return (
                  <g key={`line-${lineInfo.lineIndex}`}>
                    <polyline
                      points={points}
                      fill="none"
                      stroke="#00ff88"
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity="0.15"
                      style={{ filter: "blur(5px)" }}
                    />
                    <polyline
                      points={points}
                      fill="none"
                      stroke="#22c55e"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ filter: "drop-shadow(0 0 4px #00ff88)" }}
                    />
                  </g>
                );
              })}
            </svg>
          )}

          {/* GRID TILES */}
          <div
            className="grid grid-cols-5 h-full relative z-10"
            style={{
              paddingLeft: `${gridPaddingX}%`,
              paddingRight: `${gridPaddingX}%`,
              paddingTop: `${gridPaddingY}%`,
              paddingBottom: `${gridPaddingY}%`,
              gap: `${reelGap}%`,
            }}
          >
            {grid.map((col, colIdx) => (
              <div
                key={colIdx}
                className={`relative flex flex-col justify-between h-full transition-all duration-300 rounded-lg ${
                  teaseReels[colIdx] ? "animate-tease-pulse border border-amber-400/80 bg-amber-500/10" : ""
                }`}
              >
                {reelsSpinning[colIdx] ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-start animate-vertical-roll-downward opacity-90 z-10 py-1 overflow-hidden">
                    
                    {[...SYMBOL_LIST, ...SYMBOL_LIST].map((s, idx) => (
                      <div key={idx} className="w-full h-1/3 min-h-[30%] flex items-center justify-center p-1 filter blur-[1px]">
                        <img src={getSymbolPath(s)} alt="spinning" className="w-[95%] h-[95%] object-contain"/>
                      </div>
                    ))}
                  </div>
                ) : (
                  col.map((cell, rowIdx) => {
                    const isWinningCell = winningCellKeys.has(`${colIdx}-${rowIdx}`);
                    return (
                      <div
                        key={cell.id}
                        className={`relative flex items-center justify-center w-full h-[33%] p-1 transition-all duration-300 rounded-lg animate-cascade-drop ${
                          isWinningCell
                            ? "ring-2 sm:ring-4 ring-emerald-400 bg-emerald-500/40 scale-105 z-30 animate-pulse shadow-[0_0_15px_rgba(52,211,153,0.8)]"
                            : cell.isGold
                            ? "ring-2 ring-amber-400 shadow-md shadow-amber-500/40 animate-gold-shimmer"
                            : cell.isWild
                            ? "bg-purple-600/30 ring-1 ring-purple-400"
                            : cell.isScatter
                            ? "bg-yellow-500/20 ring-2 ring-yellow-400 animate-bounce"
                            : ""
                        }`}
                      >
                        <img src={getSymbolPath(cell.symbol)} alt={cell.symbol} className="w-full h-full object-contain pointer-events-none drop-shadow-md" />
                        {cell.isGold && (
                          <div className="absolute -top-1.5 -right-1.5 z-30 flex items-center justify-center w-6 h-6 rounded-full bg-yellow-400 border border-yellow-100 animate-bounce">
                            <span className="text-black font-black text-[10px]">
                              x{cell.multiplier}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Dashboard Control Bar */}
        <div className="grid grid-cols-5 items-center bg-slate-950/80 px-2 py-1.5 gap-1 rounded-xl border border-slate-800/80 backdrop-blur-md text-center max-w-full mx-auto shadow-md">
          {/* BALANCE */}
          <div className="flex flex-col items-center justify-center min-w-0">
            <div className="uppercase font-semibold tracking-tight text-[8px] sm:text-[9px] text-slate-400 truncate w-full">
              {balanceLabelText}
            </div>
            <div className="font-bold text-[11px] sm:text-xs text-amber-400 truncate w-full">
              ${isMounted ? balance.toLocaleString() : "0"}
            </div>
          </div>

          {/* BET CONTROLS */}
          <div className="flex flex-col items-center justify-center min-w-0">
            <div className="uppercase font-semibold tracking-tight text-[8px] sm:text-[9px] text-slate-400 mb-0.5 truncate w-full">
              {betLabelText}
            </div>
            <div className="flex items-center justify-center gap-0.5">
              <button
                onClick={handleDecreaseBet}
                disabled={isBetLocked || betAmount <= GAME_SETTINGS.presetBets[0]}
                className="bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white font-bold w-4 h-4 sm:w-5 sm:h-5 rounded text-[10px] flex items-center justify-center shrink-0 border border-slate-700"
              >
                -
              </button>
              <span className="font-bold min-w-[36px] text-center text-[10px] sm:text-xs text-amber-400 truncate">
                ${betAmount}
              </span>
              <button
                onClick={handleIncreaseBet}
                disabled={isBetLocked || betAmount >= GAME_SETTINGS.presetBets[GAME_SETTINGS.presetBets.length - 1]}
                className="bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white font-bold w-4 h-4 sm:w-5 sm:h-5 rounded text-[10px] flex items-center justify-center shrink-0 border border-slate-700"
              >
                +
              </button>
            </div>
          </div>

          {/* SPIN BUTTON */}
          <div className="flex items-center justify-center">
            <button
              onClick={() => executeSpin(null)}
              disabled={isSpinning || showScatterOverlay || showBonusSummary || !connected}
              className="group relative flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 -my-2 z-20 transition active:scale-95 disabled:opacity-40 hover:brightness-110"
            >
              <img
                src={img.spin}
                alt="Spin"
                className={`w-full h-full object-contain filter drop-shadow-xl transition-transform group-hover:scale-105 ${isSpinning ? "animate-spin" : ""}`}
              />
            </button>
          </div>

          {/* SPIN WIN */}
          <div className="flex flex-col items-center justify-center min-w-0">
            <div className="uppercase font-semibold tracking-tight text-[8px] sm:text-[9px] text-slate-400 truncate w-full">
              {winLabelText}
            </div>
            <div className="font-bold text-[11px] sm:text-xs text-emerald-400 truncate w-full">
              ${lastWin.toFixed(2)}
            </div>
          </div>

          {/* AUTO SPIN BUTTON */}
          <div className="relative flex flex-col items-center justify-center">
            {autoSpinsRemaining > 0 ? (
              <button
                onClick={stopAutoSpin}
                className="group relative flex flex-col items-center justify-center p-0.5 w-11 h-11 sm:w-12 sm:h-12 rounded-xl transition active:scale-95 hover:brightness-110"
              >
                <img src={img.autoSpin} alt="Stop Auto Spin" className="w-full h-full object-contain filter drop-shadow opacity-80 group-hover:opacity-100" />
                <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 font-black text-red-400 bg-slate-950/90 border border-red-500/80 px-1 py-0.5 rounded uppercase tracking-wider text-[7px] whitespace-nowrap">
                  ({autoSpinsRemaining})
                </span>
              </button>
            ) : (
              <button
                onClick={() => setShowAutoMenu((prev) => !prev)}
                disabled={isSpinning || freeSpins > 0 || showScatterOverlay || showBonusSummary || !connected}
                className="group relative flex flex-col items-center justify-center p-0.5 w-11 h-11 sm:w-12 sm:h-12 rounded-xl transition active:scale-95 disabled:opacity-40 hover:brightness-110"
              >
                <img src={img.autoSpin} alt="Auto Spin Options" className="w-full h-full object-contain filter drop-shadow transition-transform group-hover:scale-105" />
              </button>
            )}
          </div>
        </div>

        {warningMsg && (
          <div className="my-1.5 p-1 bg-red-950/80 border border-red-500/50 rounded-lg text-red-400 font-semibold text-[9px] sm:text-[10px] animate-pulse">
            {warningMsg}
          </div>
        )}

        {/* Game Status Readout Bar */}
        <div
          className="h-5 sm:h-6 font-extrabold my-1.5 flex items-center justify-center transition-all tracking-wide drop-shadow"
          style={{
            fontSize: `${statusFontSize}px`,
            color: statusColor,
          }}
        >
          {statusMsg}
        </div>

        {/* Footer Bar */}
        <div className="bg-slate-950/70 px-2 sm:px-3 py-1.5 rounded-xl border border-slate-800/80 flex items-center justify-between backdrop-blur-md relative gap-1.5">
          {freeSpins > 0 ? (
            <span className="bg-emerald-600 text-white font-extrabold px-2 py-0.5 rounded-full shadow text-[8px] sm:text-[10px]">
              FS WIN: ${totalBonusWin.toFixed(2)}
            </span>
          ) : (
            <div className="flex items-center">
              <span className="uppercase font-bold tracking-wider text-[10px] text-slate-400">
                {footerMsgText}
              </span>
            </div>
          )}

          {/* Speed Controls */}
          <div className="flex items-center gap-0.5">
            <span className="uppercase font-semibold text-[9px] text-slate-400 hidden sm:inline">
              {speedLabelText}
            </span>
            <button
              onClick={handleDecreaseSpeed}
              disabled={speedLevel <= 1}
              className="bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white font-bold w-4 h-4 sm:w-5 sm:h-5 rounded text-[10px] border border-slate-700 flex items-center justify-center"
            >
              -
            </button>
            <span className="font-bold text-amber-300 min-w-[32px] text-center text-[9px] sm:text-[10px]">
              {SPEED_CONFIG[speedLevel].label}
            </span>
            <button
              onClick={handleIncreaseSpeed}
              disabled={speedLevel >= 4}
              className="bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white font-bold w-4 h-4 sm:w-5 sm:h-5 rounded text-[10px] border border-slate-700 flex items-center justify-center"
            >
              +
            </button>
          </div>

          {/* Buy Bonus Feature */}
          <button
            onClick={() => setShowBuyBonusConfirm(true)}
            disabled={isSpinning || balance < featureBuyCost || freeSpins > 0 || showScatterOverlay || showBonusSummary || !connected}
            className="group relative flex flex-row items-center justify-center rounded-lg transition active:scale-95 disabled:opacity-40 hover:brightness-110 gap-1 w-28 sm:w-36 h-8 sm:h-9 bg-amber-500/10 border border-amber-500/30 p-0.5"
          >
            <img src={img.buyBonus} alt="Buy Bonus" className="w-1/2 h-full object-contain filter drop-shadow transition-transform group-hover:scale-105" />
            <span className="font-mono font-extrabold text-amber-300 bg-slate-950/90 rounded border border-slate-800 shadow text-[9px] sm:text-[10px] px-1 py-0.5">
              ${featureBuyCost}
            </span>
          </button>

          {showAutoMenu && (
            <div className="absolute bottom-full right-0 mb-2 bg-slate-900 border border-slate-700 p-1.5 rounded-xl shadow-xl z-50 flex flex-col gap-1 w-24 sm:w-28">
              {GAME_SETTINGS.autoSpinOptions.map((count) => (
                <button
                  key={count}
                  onClick={() => startAutoSpin(count)}
                  className="bg-slate-800 hover:bg-amber-500 hover:text-slate-950 text-white font-bold py-1 px-2 rounded-lg transition text-center text-[9px]"
                >
                  {count} Spins
                </button>
              ))}
              <button
                onClick={() => setShowAutoMenu(false)}
                className="bg-red-950/80 hover:bg-red-800 text-red-300 border border-red-700/50 font-bold py-1 px-2 rounded-lg transition text-center text-[9px] mt-0.5"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}