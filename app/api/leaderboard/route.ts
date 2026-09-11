import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  try {
    // Fetch top players based on highest payout or score from your spins table
    // (Or aggregate total wins/scores depending on your app design)
    const { data: topSpins, error } = await supabaseAdmin
      .from("spins")
      .select("wallet_address, payout")
      .order("payout", { ascending: false })
      .limit(10);

    if (error) throw error;

    // Format into leaderboard structure with ranks
    const leaderboard = (topSpins || []).map((spin, index) => ({
      rank: index + 1,
      wallet: spin.wallet_address,
      score: Number(spin.payout) || 0,
    }));

    return NextResponse.json({ success: true, leaderboard });
  } catch (error: any) {
    console.error("Leaderboard fetch error:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch leaderboard" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const walletAddress = body.walletAddress ? String(body.walletAddress).trim() : null;
    const score = Number(body.score);

    if (!walletAddress || isNaN(score)) {
      return NextResponse.json({ success: false, error: "Invalid payload" }, { status: 400 });
    }

    // Note: In a real slot/casino app, scores/payouts should ideally be recorded 
    // automatically inside your game-spin route rather than trusted blindly from a client POST request.
    // However, if you track high scores in a dedicated table, you can upsert them here:

    const { error } = await supabaseAdmin
      .from("leaderboard")
      .upsert(
        { wallet_address: walletAddress, score, updated_at: new Date().toISOString() },
        { onConflict: "wallet_address" }
      );

    if (error) {
      // Fallback if dedicated leaderboard table isn't created yet; 
      // otherwise, ensure you create a 'leaderboard' table with (wallet_address PRIMARY KEY, score NUMERIC).
      console.warn("Leaderboard table upsert warning:", error.message);
    }

    // Fetch fresh top 10 to return
    const { data: topUsers, error: fetchError } = await supabaseAdmin
      .from("leaderboard")
      .select("wallet_address, score")
      .order("score", { ascending: false })
      .limit(10);

    if (fetchError) throw fetchError;

    const leaderboard = (topUsers || []).map((item, index) => ({
      rank: index + 1,
      wallet: item.wallet_address,
      score: Number(item.score) || 0,
    }));

    return NextResponse.json({ success: true, leaderboard });

  } catch (error: any) {
    console.error("Leaderboard update error:", error);
    return NextResponse.json({ success: false, error: "Failed to update leaderboard" }, { status: 500 });
  }
}