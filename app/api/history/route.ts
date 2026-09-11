import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export interface TransactionHistoryItem {
  id: string | number;
  type: "SPIN" | "DEPOSIT" | "WITHDRAWAL" | "BONUS_BUY";
  game_name?: string;
  bet_amount?: number;
  amount?: number;
  payout: number;
  multiplier: number;
  created_at: string;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get("walletAddress");

    if (!walletAddress) {
      return NextResponse.json(
        { success: false, error: "Wallet address is required" },
        { status: 400 }
      );
    }

    const cleanWallet = walletAddress.trim();

    // 1. Fetch deposits
    const { data: deposits } = await supabaseAdmin
      .from("deposits")
      .select("id, amount, created_at")
      .ilike("wallet_address", cleanWallet)
      .order("created_at", { ascending: false })
      .limit(10);

    // 2. Fetch withdrawals
    const { data: withdrawals } = await supabaseAdmin
      .from("withdrawals")
      .select("id, amount, created_at")
      .ilike("wallet_address", cleanWallet)
      .order("created_at", { ascending: false })
      .limit(10);

    // 3. Fetch standard spins (Token Rush, Moon Mission, etc.)
    const { data: spins } = await supabaseAdmin
      .from("spins")
      .select("id, game, bet_amount, payout, created_at")
      .ilike("wallet_address", cleanWallet)
      .order("created_at", { ascending: false })
      .limit(25);

    // 4. Fetch Meme Fortune roulette rounds from 'roulette_rounds'
    const { data: rouletteSpins } = await supabaseAdmin
      .from("roulette_rounds")
      .select("id, bet_amount, payout, created_at")
      .ilike("wallet_address", cleanWallet)
      .order("created_at", { ascending: false })
      .limit(25);

    const history: TransactionHistoryItem[] = [];

    if (deposits) {
      for (const d of deposits) {
        history.push({
          id: `dep-${d.id}`,
          type: "DEPOSIT",
          game_name: "Deposit",
          amount: Number(d.amount) || 0,
          payout: 0,
          multiplier: 0,
          created_at: d.created_at || new Date().toISOString(),
        });
      }
    }

    if (withdrawals) {
      for (const w of withdrawals) {
        history.push({
          id: `wit-${w.id}`,
          type: "WITHDRAWAL",
          game_name: "Withdrawal",
          amount: Number(w.amount) || 0,
          payout: 0,
          multiplier: 0,
          created_at: w.created_at || new Date().toISOString(),
        });
      }
    }

    if (spins) {
      for (const s of spins) {
        const bet = Number(s.bet_amount) || 0;
        const payout = Number(s.payout) || 0;
        const mult = bet > 0 ? Number((payout / bet).toFixed(2)) : 0;

        history.push({
          id: `spin-${s.id}`,
          type: "SPIN",
          game_name: s.game || "Casino Spin",
          bet_amount: bet,
          payout: payout,
          multiplier: mult,
          created_at: s.created_at || new Date().toISOString(),
        });
      }
    }

    if (rouletteSpins) {
      for (const r of rouletteSpins) {
        const bet = Number(r.bet_amount) || 0;
        const payout = Number(r.payout) || 0;
        const mult = bet > 0 ? Number((payout / bet).toFixed(2)) : 0;

        history.push({
          id: `roulette-${r.id}`,
          type: "SPIN",
          game_name: "Meme Fortune",
          bet_amount: bet,
          payout: payout,
          multiplier: mult,
          created_at: r.created_at || new Date().toISOString(),
        });
      }
    }

    // Sort globally by newest first and limit results
    history.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const limitedHistory = history.slice(0, 25);

    return NextResponse.json({ success: true, history: limitedHistory });

  } catch (error: any) {
    console.error("Transaction history error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}