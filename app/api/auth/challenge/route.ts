import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin"; // Use admin service role client

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const walletAddress = body.walletAddress ? String(body.walletAddress).trim() : null;

    if (!walletAddress) {
      return NextResponse.json(
        { error: "Missing wallet address" },
        { status: 400 }
      );
    }

    const nonce = randomBytes(32).toString("hex");

    // 5-minute expiration window
    const expiresAt = new Date(
      Date.now() + 5 * 60 * 1000
    ).toISOString();

    const { error } = await supabaseAdmin
      .from("auth_challenges")
      .upsert({
        wallet_address: walletAddress,
        nonce,
        expires_at: expiresAt,
      }, {
        onConflict: "wallet_address" // Ensures upsert overwrites existing active challenge per wallet
      });

    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: `Welcome to MemeSlot!

Sign this message to authenticate.

Nonce:
${nonce}`,
    });

  } catch (err: any) {
    console.error("Challenge generation error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}