"use client";

import React from "react";

interface RouletteRoadMapProps {
  history: Array<number | "00">;
  isRed: (num: number) => boolean;
}

export default function RouletteRoadMap({ history, isRed }: RouletteRoadMapProps) {
  // Calculate basic statistics from history
  const totalSpins = history.length;
  if (totalSpins === 0) {
    return (
      <div className="w-full bg-[#062318] border border-[#174f35] rounded-lg p-3 text-center">
        <span className="text-[8px] text-emerald-400 font-bold uppercase tracking-wider">
          📊 Trend History: Waiting for spins...
        </span>
      </div>
    );
  }

  let redCount = 0;
  let blackCount = 0;
  let greenCount = 0;
  let evenCount = 0;
  let oddCount = 0;

  history.forEach((num) => {
    if (num === 0 || num === "00") {
      greenCount++;
    } else if (isRed(num)) {
      redCount++;
      if (num % 2 === 0) evenCount++;
      else oddCount++;
    } else {
      blackCount++;
      if (num % 2 === 0) evenCount++;
      else oddCount++;
    }
  });

  const redPct = ((redCount / totalSpins) * 100).toFixed(0);
  const blackPct = ((blackCount / totalSpins) * 100).toFixed(0);
  const greenPct = ((greenCount / totalSpins) * 100).toFixed(0);

  return (
    <div className="w-full bg-[#062318] border border-[#174f35] rounded-lg p-2.5 flex flex-col gap-2 shadow-md">
          {/* Distribution Bars */}
      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-[7px] font-bold text-emerald-200">
          <span className="text-red-400">Red: {redCount} ({redPct}%)</span>
          <span className="text-slate-300">Black: {blackCount} ({blackPct}%)</span>
          <span className="text-emerald-400">Zero/00: {greenCount} ({greenPct}%)</span>
        </div>
        <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden flex border border-[#174f35]">
          <div style={{ width: `${redPct}%` }} className="bg-red-600 h-full transition-all duration-300" />
          <div style={{ width: `${blackPct}%` }} className="bg-slate-700 h-full transition-all duration-300" />
          <div style={{ width: `${greenPct}%` }} className="bg-emerald-600 h-full transition-all duration-300" />
        </div>
      </div>

      {/* Baccarat Style Bead Grid layout (Compact Matrix) */}
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pt-1">
        <div className="grid grid-flow-col grid-rows-3 gap-1 p-1 bg-[#031b12] rounded border border-[#174f35] min-w-full">
          {history.map((num, idx) => {
            const isGrn = num === 0 || num === "00";
            const red = !isGrn && isRed(num as number);
            return (
              <div
                key={`bead-${idx}`}
                className={`w-4 h-4 rounded-full flex items-center justify-center text-[6px] font-black text-white shrink-0 ${
                  isGrn
                    ? "bg-emerald-600 border border-emerald-400"
                    : red
                    ? "bg-red-600 border border-red-400"
                    : "bg-slate-900 border border-slate-700"
                }`}
                title={`Round Index ${idx}: ${num}`}
              >
                {num}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}