"use client";

import React, { useEffect, useState } from 'react';

interface LeaderboardEntry {
  rank: number;
  wallet: string;
  score: number;
}

export default function LeaderboardModal({ onClose }: { onClose: () => void }) {
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
      <div className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-[#0f0f17] p-6 text-white shadow-2xl">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white font-bold text-sm bg-slate-800 w-8 h-8 rounded-full flex items-center justify-center transition"
        >
          ✕
        </button>

        <h3 className="text-2xl font-black mb-1 text-purple-400">🏆 Top Degen Leaderboard</h3>
        <p className="text-xs text-slate-400 mb-6">Top high-rollers ranked by total earnings this season.</p>

        {loading ? (
          <div className="py-12 text-center text-slate-500 font-mono">Loading rankings...</div>
        ) : leaders.length === 0 ? (
          <div className="py-12 text-center text-slate-400 bg-white/5 rounded-xl border border-white/5">
            <p className="text-sm font-bold text-purple-300">No players on the board yet!</p>
            <p className="text-xs text-slate-500 mt-1">Be the first player to spin and claim #1.</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
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
                <span className="font-mono font-bold text-sm">{entry.score.toLocaleString()} TOKEN</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}