"use client";

import React, { useState } from 'react';
import { generateGameOutcome } from "../../utils/provablyFair";


export default function ProvablyFairChecker() {
  const [serverSeed, setServerSeed] = useState('');
  const [clientSeed, setClientSeed] = useState('');
  const [nonce, setNonce] = useState(0);
  const [verifiedResult, setVerifiedResult] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const handleVerify = async () => {
    try {
      setLoading(true);
      const result = await generateGameOutcome(serverSeed, clientSeed, Number(nonce));
      setVerifiedResult(result);
    } catch (e) {
      alert('Invalid input parameters for verification.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl text-white max-w-lg mx-auto shadow-xl">
      <h3 className="text-xl font-black mb-2 text-cyan-400">🛡️ Provably Fair Verifier</h3>
      <p className="text-xs sm:text-sm text-slate-400 mb-4">
        Verify the mathematical integrity of any past spin by inputting the revealed server seed, your client seed, and the spin nonce.
      </p>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-bold uppercase text-slate-400 mb-1">Revealed Server Seed</label>
          <input 
            type="text" 
            value={serverSeed} 
            onChange={(e) => setServerSeed(e.target.value)}
            placeholder="e.g. 7f8c9... (revealed post-game)"
            className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-cyan-500 font-mono"
          />
        </div>

        <div>
          <label className="block text-xs font-bold uppercase text-slate-400 mb-1">Client Seed</label>
          <input 
            type="text" 
            value={clientSeed} 
            onChange={(e) => setClientSeed(e.target.value)}
            placeholder="e.g. browser-generated-string"
            className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-cyan-500 font-mono"
          />
        </div>

        <div>
          <label className="block text-xs font-bold uppercase text-slate-400 mb-1">Nonce (Spin Index)</label>
          <input 
            type="number" 
            value={nonce} 
            onChange={(e) => setNonce(Number(e.target.value))}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-cyan-500 font-mono"
          />
        </div>

        <button 
          onClick={handleVerify}
          disabled={loading}
          className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 font-extrabold py-3 rounded-xl hover:opacity-95 transition text-sm shadow-lg shadow-cyan-500/20 active:scale-95 disabled:opacity-50"
        >
          {loading ? "Verifying..." : "Verify Outcome Match"}
        </button>

        {verifiedResult !== null && (
          <div className="mt-4 p-4 bg-slate-950 rounded-xl border border-emerald-500/30 text-center">
            <span className="text-xs uppercase font-bold text-slate-400">Calculated Outcome Float:</span>
            <div className="text-xl font-mono text-emerald-400 mt-1 font-black">{verifiedResult.toFixed(6)}</div>
          </div>
        )}
      </div>
    </div>
  );
}