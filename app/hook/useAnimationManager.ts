import { useState, useCallback } from "react";

export type BackgroundMode =
  | "normal"
  | "win"
  | "bonus"
  | "bigwin"
  | "jackpot";

export interface WinOverlayState {
  visible: boolean;
  title: string;
  amount: number;
  multiplier: number;
}

export default function useAnimationManager() {
  const [screenShake, setScreenShake] = useState(false);
  const [coinRain, setCoinRain] = useState(false);
  const [multiplierPunch, setMultiplierPunch] = useState(false);
  const [backgroundMode, setBackgroundMode] =
    useState<BackgroundMode>("normal");

  const [winOverlay, setWinOverlay] =
    useState<WinOverlayState | null>(null);

  const triggerShake = useCallback((duration = 400) => {
    setScreenShake(true);

    setTimeout(() => {
      setScreenShake(false);
    }, duration);
  }, []);

  const triggerMultiplierPunch = useCallback(() => {
    setMultiplierPunch(true);

    setTimeout(() => {
      setMultiplierPunch(false);
    }, 350);
  }, []);

  const triggerCoinRain = useCallback((duration = 2000) => {
    setCoinRain(true);

    setTimeout(() => {
      setCoinRain(false);
    }, duration);
  }, []);

  return {
    screenShake,
    coinRain,
    multiplierPunch,
    backgroundMode,
    winOverlay,

    setBackgroundMode,
    setWinOverlay,

    triggerShake,
    triggerCoinRain,
    triggerMultiplierPunch,
  };
}