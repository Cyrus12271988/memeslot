import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { SignJWT } from "jose";

const secret = new TextEncoder().encode(process.env.JWT_SECRET!);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const walletAddress = body.walletAddress ? String(body.walletAddress).trim() : null;
    const { signature, message } = body;

    if (!walletAddress || !signature || !message) {
      return NextResponse.json(
        { error: "Missing fields" },
        { status: 400 }
      );
    }

    // 1. Get challenge using admin client with case-insensitive check
    const { data: challenge, error } = await supabaseAdmin
      .from("auth_challenges")
      .select("*")
      .ilike("wallet_address", walletAddress)
      .maybeSingle();

    if (error || !challenge) {
      return NextResponse.json(
        { error: "Challenge not found" },
        { status: 400 }
      );
    }

    // 2. Check expiration
    if (new Date(challenge.expires_at) < new Date()) {
      // Clean up expired challenge immediately
      await supabaseAdmin.from("auth_challenges").delete().ilike("wallet_address", walletAddress);
      return NextResponse.json(
        { error: "Challenge expired" },
        { status: 400 }
      );
    }

    // 3. Make sure the signed message contains the stored nonce
    if (!message.includes(challenge.nonce)) {
      return NextResponse.json(
        { error: "Invalid challenge" },
        { status: 400 }
      );
    }

    // 4. Verify Solana Ed25519 signature
    const verified = nacl.sign.detached.verify(
      new TextEncoder().encode(message),
      bs58.decode(signature),
      bs58.decode(walletAddress)
    );

    if (!verified) {
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 }
      );
    }

    // 5. Delete challenge immediately to prevent reuse (Replay Shield)
    await supabaseAdmin
      .from("auth_challenges")
      .delete()
      .ilike("wallet_address", walletAddress);

    // 6. Optional & Recommended: Ensure user record exists in the users table upon successful login
    await supabaseAdmin
      .from("users")
      .upsert(
        { wallet_address: walletAddress, vault_balance: 0 },
        { onConflict: "wallet_address", ignoreDuplicates: true }
      );

    // 7. Create JWT Session Token
    const token = await new SignJWT({
      wallet: walletAddress,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("24h")
      .sign(secret);

    const response = NextResponse.json({
      success: true,
      message: "Authenticated successfully",
    });

    response.cookies.set("session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24, // 24 Hours
    });

    return response;

  } catch (err: any) {
    console.error("Auth verify error:", err);

    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}