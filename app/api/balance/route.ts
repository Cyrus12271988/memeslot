import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin"; // Use admin client to bypass RLS safely on the server

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get("walletAddress");

    if (!walletAddress) {
      return NextResponse.json(
        { success: false, error: "Missing walletAddress parameter" },
        { status: 400 }
      );
    }

    const {
      data: user,
      error,
    } = await supabaseAdmin
      .from("users")
      .select("vault_balance, free_spins_left, current_multiplier")
      .ilike("wallet_address", walletAddress.trim()) // Using ilike to prevent case-sensitive mismatch bugs with Solana addresses
      .maybeSingle();

    if (error) throw error;

    let currentUser = user;

    if (!currentUser) {
      const {
        data: insertedUser,
        error: insertError,
      } = await supabaseAdmin
        .from("users")
        .insert({
          wallet_address: walletAddress.trim(),
          vault_balance: 0,
          free_spins_left: 0,
          current_multiplier: 1,
        })
        .select("vault_balance, free_spins_left, current_multiplier")
        .single();

      if (insertError) throw insertError;

      currentUser = insertedUser;
    }

    return NextResponse.json({
      success: true,
      balance: Number(currentUser.vault_balance) || 0,
      freeSpinsLeft: Number(currentUser.free_spins_left) || 0,
      currentMultiplier: Number(currentUser.current_multiplier) || 1,
    });

  } catch (error: any) {
    console.error("Balance fetch error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || "Internal server error",
      },
      {
        status: 500
      }
    );
  }
}