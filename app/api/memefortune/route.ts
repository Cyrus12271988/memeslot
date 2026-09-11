import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// ============================================================
// AMERICAN ROULETTE
// 0 + 00 + 1-36
// ============================================================

const ROULETTE_WHEEL_SEQUENCE: Array<number | "00"> = [
  0,
  15,
  32,
  19,
  4,
  21,
  2,
  25,
  17,
  34,
  6,
  27,
  13,
  36,
  11,
  30,
  8,
  23,
  10,
  "00",
  5,
  24,
  16,
  33,
  1,
  20,
  14,
  31,
  9,
  22,
  18,
  29,
  7,
  28,
  12,
  35,
  3,
  26,
];

// ============================================================
// RED NUMBERS
// ============================================================

const RED_NUMBERS = [
  1,
  3,
  5,
  7,
  9,
  12,
  14,
  16,
  18,
  19,
  21,
  23,
  25,
  27,
  30,
  32,
  34,
  36,
];

type WinningNumber = number | "00";

type BetType =
  | "number"
  | "red"
  | "black"
  | "even"
  | "odd"
  | "low"
  | "high"
  | "dozen"
  | "column";

interface Bet {
  type: BetType;
  value?: number | "00";
  dozenIndex?: number;
  columnIndex?: number;
  amount: number;
}

// ============================================================
// HOUSE / RISK LIMITS
// ============================================================

const HOUSE_BANKROLL_REFERENCE = 30_000_000;

const MIN_BET = 10_000;

const MAX_NUMBER_BET = 50_000;

const MAX_OUTSIDE_BET = 100_000;

const MAX_DOZEN_BET = 100_000;

const MAX_COLUMN_BET = 100_000;

const MAX_PLAYER_ROUND_EXPOSURE = 300_000;

const MAX_GLOBAL_ROUND_EXPOSURE = 600_000;

const MAX_GLOBAL_PAYOUT_LIABILITY = 3_000_000;

const DEFAULT_GUEST_BALANCE = 1_000_000;

// ============================================================
// HOUSE VAULT
//
// IMPORTANT:
//
// public.house_vault must contain:
//
// id = 1
//
// balance = your starting house bankroll
//
// Example:
//
// id: 1
// balance: 30000000
// ============================================================

const HOUSE_VAULT_ID = 1;

// ============================================================
// GLOBAL SHARED GAME STATE
// ============================================================

let globalGameState = {
  roundId: 1,

  status: "betting" as "betting" | "spinning",

  countdown: 60,

  winningNumber: 7 as WinningNumber,

  recentNumbers: [
    7,
    32,
    15,
    3,
    0,
    26,
  ] as WinningNumber[],
};

// ============================================================
// ROUND BET STORAGE
// ============================================================

const roundBetsMap = new Map<
  number,
  Map<string, Bet[]>
>();

// ============================================================
// BET TYPES
// ============================================================

const VALID_BET_TYPES = new Set<string>([
  "number",
  "red",
  "black",
  "even",
  "odd",
  "low",
  "high",
  "dozen",
  "column",
]);

// ============================================================
// BET MULTIPLIERS
//
// These are PROFIT multipliers.
//
// number = 32:1
// dozen/column = 2:1
// outside = 1:1
// ============================================================

function getMultiplier(betType: string): number {
  switch (betType) {
    case "number":
      return 32;

    case "dozen":
    case "column":
      return 2;

    case "red":
    case "black":
    case "even":
    case "odd":
    case "low":
    case "high":
      return 1;

    default:
      return 0;
  }
}

// ============================================================
// MAXIMUM BET PER TYPE
// ============================================================

function getMaximumBet(betType: string): number {
  switch (betType) {
    case "number":
      return MAX_NUMBER_BET;

    case "dozen":
      return MAX_DOZEN_BET;

    case "column":
      return MAX_COLUMN_BET;

    case "red":
    case "black":
    case "even":
    case "odd":
    case "low":
    case "high":
      return MAX_OUTSIDE_BET;

    default:
      return 0;
  }
}

// ============================================================
// POTENTIAL PAYOUT
//
// Includes original wager + winnings.
//
// Example:
//
// 50,000 straight-up
//
// Profit = 1,600,000
// Returned stake = 50,000
// Total payout = 1,650,000
// ============================================================

function getPotentialPayout(bet: Bet): number {
  const amount = Number(bet.amount) || 0;

  const multiplier = getMultiplier(bet.type);

  return amount + amount * multiplier;
}

// ============================================================
// CHECK WHETHER BET WON
// ============================================================

function checkBetWin(
  bet: Bet,
  winningNumber: WinningNumber
): boolean {
  switch (bet.type) {
    // --------------------------------------------------------
    // NUMBER
    // --------------------------------------------------------

    case "number":
      return (
        String(bet.value) ===
        String(winningNumber)
      );

    // --------------------------------------------------------
    // RED
    // --------------------------------------------------------

    case "red":
      return (
        typeof winningNumber === "number" &&
        RED_NUMBERS.includes(winningNumber)
      );

    // --------------------------------------------------------
    // BLACK
    // --------------------------------------------------------

    case "black":
      return (
        typeof winningNumber === "number" &&
        winningNumber !== 0 &&
        !RED_NUMBERS.includes(winningNumber)
      );

    // --------------------------------------------------------
    // EVEN
    // --------------------------------------------------------

    case "even":
      return (
        typeof winningNumber === "number" &&
        winningNumber !== 0 &&
        winningNumber % 2 === 0
      );

    // --------------------------------------------------------
    // ODD
    // --------------------------------------------------------

    case "odd":
      return (
        typeof winningNumber === "number" &&
        winningNumber !== 0 &&
        winningNumber % 2 !== 0
      );

    // --------------------------------------------------------
    // LOW
    // --------------------------------------------------------

    case "low":
      return (
        typeof winningNumber === "number" &&
        winningNumber >= 1 &&
        winningNumber <= 18
      );

    // --------------------------------------------------------
    // HIGH
    // --------------------------------------------------------

    case "high":
      return (
        typeof winningNumber === "number" &&
        winningNumber >= 19 &&
        winningNumber <= 36
      );

    // --------------------------------------------------------
    // DOZEN
    // --------------------------------------------------------

    case "dozen":
      if (typeof winningNumber !== "number") {
        return false;
      }

      if (bet.dozenIndex === 1) {
        return (
          winningNumber >= 1 &&
          winningNumber <= 12
        );
      }

      if (bet.dozenIndex === 2) {
        return (
          winningNumber >= 13 &&
          winningNumber <= 24
        );
      }

      if (bet.dozenIndex === 3) {
        return (
          winningNumber >= 25 &&
          winningNumber <= 36
        );
      }

      return false;

    // --------------------------------------------------------
    // COLUMN
    // --------------------------------------------------------

    case "column":
      if (
        typeof winningNumber !== "number" ||
        winningNumber === 0
      ) {
        return false;
      }

      {
        const column =
          winningNumber % 3 === 0
            ? 3
            : winningNumber % 3;

        return (
          column === bet.columnIndex
        );
      }

    default:
      return false;
  }
}

// ============================================================
// GET ROUND EXPOSURE
// ============================================================

function getRoundExposure(roundId: number) {
  const roundMap = roundBetsMap.get(roundId);

  if (!roundMap) {
    return {
      totalBetAmount: 0,
      maximumPossiblePayout: 0,
    };
  }

  let totalBetAmount = 0;

  const allBets: Bet[] = [];

  for (const bets of roundMap.values()) {
    for (const bet of bets) {
      totalBetAmount += Number(bet.amount) || 0;
      allBets.push(bet);
    }
  }

  let maximumPossiblePayout = 0;

  for (const possibleNumber of ROULETTE_WHEEL_SEQUENCE) {
    let payout = 0;

    for (const bet of allBets) {
      if (
        checkBetWin(
          bet,
          possibleNumber
        )
      ) {
        payout += getPotentialPayout(bet);
      }
    }

    if (
      payout >
      maximumPossiblePayout
    ) {
      maximumPossiblePayout = payout;
    }
  }

  return {
    totalBetAmount,
    maximumPossiblePayout,
  };
}

// ============================================================
// HOUSE VAULT HELPERS
// ============================================================

async function getHouseVaultBalance(): Promise<number> {
  const {
    data,
    error,
  } = await supabaseAdmin
    .from("house_vault")
    .select("balance")
    .eq("id", HOUSE_VAULT_ID)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error(
      "House vault row id=1 was not found."
    );
  }

  return Number(data.balance) || 0;
}

// ============================================================
// UPDATE HOUSE VAULT
//
// Positive amount = house gains
//
// Negative amount = house pays
// ============================================================

async function changeHouseVault(
  amount: number
): Promise<number> {
  const currentBalance =
    await getHouseVaultBalance();

  const newBalance =
    currentBalance + amount;

  if (newBalance < 0) {
    throw new Error(
      `House vault has insufficient balance. Current: ${currentBalance}, required: ${Math.abs(amount)}`
    );
  }

  const {
    error,
  } = await supabaseAdmin
    .from("house_vault")
    .update({
      balance: newBalance,
      updated_at: new Date().toISOString(),
    })
    .eq("id", HOUSE_VAULT_ID);

  if (error) {
    throw error;
  }

  return newBalance;
}

// ============================================================
// SAVE ROULETTE ROUND HISTORY
// ============================================================

async function saveRouletteHistory(
  walletAddress: string,
  totalBetAmount: number,
  totalPayout: number
) {
  try {
    const multiplier =
      totalBetAmount > 0
        ? Number(
            (
              totalPayout /
              totalBetAmount
            ).toFixed(2)
          )
        : 0;

    const {
      error,
    } = await supabaseAdmin
      .from("roulette_rounds")
      .insert({
        wallet_address:
          walletAddress.trim(),

        bet_amount:
          totalBetAmount,

        payout:
          totalPayout,

        multiplier,
      });

    if (error) {
      console.error(
        "❌ Error saving roulette history:",
        error
      );
    }
  } catch (error) {
    console.error(
      "❌ Exception saving roulette history:",
      error
    );
  }
}

// ============================================================
// RESOLVE ROUND
//
// IMPORTANT HOUSE LOGIC:
//
// Player loses:
//
//   player -bet
//   house  +bet
//
// Player wins:
//
//   player -bet
//   house  +bet
//   player +payout
//   house  -payout
//
// Therefore:
//
// HOUSE NET CHANGE
//
// = total bets - total payouts
// ============================================================

async function resolveRoundBets(
  roundId: number,
  winningNumber: WinningNumber
) {
  const userBetsMap =
    roundBetsMap.get(roundId);

  if (!userBetsMap) {
    return;
  }

  let roundTotalBet = 0;
  let roundTotalPayout = 0;

  // ========================================================
  // CALCULATE ALL PLAYER RESULTS FIRST
  // ========================================================

  const results: Array<{
    walletAddress: string;
    bets: Bet[];
    totalBetAmount: number;
    totalPayout: number;
  }> = [];

  for (
    const [
      walletAddress,
      bets,
    ] of userBetsMap.entries()
  ) {
    let totalBetAmount = 0;
    let totalPayout = 0;

    for (const bet of bets) {
      const amount =
        Number(bet.amount) || 0;

      totalBetAmount += amount;

      if (
        checkBetWin(
          bet,
          winningNumber
        )
      ) {
        totalPayout +=
          getPotentialPayout(bet);
      }
    }

    roundTotalBet +=
      totalBetAmount;

    roundTotalPayout +=
      totalPayout;

    results.push({
      walletAddress,
      bets,
      totalBetAmount,
      totalPayout,
    });
  }

  // ========================================================
  // HOUSE NET CHANGE
  // ========================================================

  const houseNetChange =
    roundTotalBet -
    roundTotalPayout;

  // ========================================================
  // CHECK HOUSE VAULT
  //
  // We never allow a payout that would push the
  // house vault below zero.
  // ========================================================

  let houseBalanceBefore = 0;
  let houseBalanceAfter = 0;

  try {
    houseBalanceBefore =
      await getHouseVaultBalance();

    if (
      houseNetChange < 0 &&
      houseBalanceBefore <
        Math.abs(houseNetChange)
    ) {
      console.error(
        "❌ HOUSE VAULT INSUFFICIENT FOR ROUND",
        {
          roundId,
          winningNumber,
          houseBalance:
            houseBalanceBefore,
          required:
            Math.abs(houseNetChange),
          totalBets:
            roundTotalBet,
          totalPayout:
            roundTotalPayout,
        }
      );

      // Do not silently create money.
      // The round is still recorded, but payouts
      // are not credited if the house cannot cover them.
      //
      // In normal operation your liability limits
      // should prevent reaching this situation.
      return;
    }

    // ======================================================
    // UPDATE HOUSE VAULT
    // ======================================================

    houseBalanceAfter =
      await changeHouseVault(
        houseNetChange
      );

    console.log(
      "🏦 HOUSE VAULT UPDATED",
      {
        roundId,
        winningNumber,
        totalBets:
          roundTotalBet,
        totalPayout:
          roundTotalPayout,
        houseNetChange,
        houseBalanceBefore,
        houseBalanceAfter,
      }
    );
  } catch (error) {
    console.error(
      "❌ HOUSE VAULT UPDATE FAILED:",
      error
    );

    return;
  }

  // ========================================================
  // PAY WINNERS
  // ========================================================

  for (const result of results) {
    const {
      walletAddress,
      totalBetAmount,
      totalPayout,
    } = result;

    // Always save roulette history.
    await saveRouletteHistory(
      walletAddress,
      totalBetAmount,
      totalPayout
    );

    // Guest accounts don't use real vault.
    if (
      walletAddress ===
      "global_guest"
    ) {
      continue;
    }

    // No payout = player lost.
    if (totalPayout <= 0) {
      console.log(
        "🎰 PLAYER LOST",
        {
          walletAddress,
          roundId,
          winningNumber,
          bet:
            totalBetAmount,
          payout: 0,
        }
      );

      continue;
    }

    // ======================================================
    // CREDIT WINNER
    // ======================================================

    try {
      const {
        data: user,
        error,
      } = await supabaseAdmin
        .from("users")
        .select("vault_balance")
        .ilike(
          "wallet_address",
          walletAddress.trim()
        )
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!user) {
        console.error(
          "❌ Winner account not found:",
          walletAddress
        );
        continue;
      }

      const currentBalance =
        Number(
          user.vault_balance
        ) || 0;

      const newBalance =
        currentBalance +
        totalPayout;

      const {
        error:
          updateError,
      } = await supabaseAdmin
        .from("users")
        .update({
          vault_balance:
            newBalance,
        })
        .ilike(
          "wallet_address",
          walletAddress.trim()
        );

      if (updateError) {
        throw updateError;
      }

      console.log(
        "🏆 PLAYER WON",
        {
          walletAddress,
          roundId,
          winningNumber,
          bet:
            totalBetAmount,
          payout:
            totalPayout,
          newBalance,
        }
      );
    } catch (error) {
      console.error(
        "❌ Error crediting roulette payout:",
        walletAddress,
        error
      );
    }
  }

  // ========================================================
  // ROUND COMPLETE
  // ========================================================

  console.log(
    "🎡 ROUND RESOLVED",
    {
      roundId,
      winningNumber,
      totalBets:
        roundTotalBet,
      totalPayout:
        roundTotalPayout,
      houseNetChange,
      houseBalanceAfter,
    }
  );
}

// ============================================================
// GLOBAL TIMER
// ============================================================

let isLoopRunning = false;

function startGlobalGameLoop() {
  if (isLoopRunning) {
    return;
  }

  isLoopRunning = true;

  setInterval(async () => {
    // ======================================================
    // BETTING
    // ======================================================

    if (
      globalGameState.status ===
      "betting"
    ) {
      globalGameState.countdown -= 1;

      if (
        globalGameState.countdown <= 0
      ) {
        globalGameState.status =
          "spinning";

        globalGameState.countdown = 5;

        // ==================================================
        // RANDOM RESULT
        // ==================================================

        const randomIndex =
          Math.floor(
            Math.random() *
              ROULETTE_WHEEL_SEQUENCE.length
          );

        globalGameState.winningNumber =
          ROULETTE_WHEEL_SEQUENCE[
            randomIndex
          ];

        // ==================================================
        // RESOLVE ROUND
        // ==================================================

        await resolveRoundBets(
          globalGameState.roundId,
          globalGameState.winningNumber
        );
      }
    }

    // ======================================================
    // SPINNING
    // ======================================================

    else if (
      globalGameState.status ===
      "spinning"
    ) {
      globalGameState.countdown -= 1;

      if (
        globalGameState.countdown <= 0
      ) {
        globalGameState.status =
          "betting";

        globalGameState.countdown =
          30;

        globalGameState.roundId += 1;

        globalGameState.recentNumbers =
          [
            globalGameState.winningNumber,
            ...globalGameState.recentNumbers,
          ].slice(0, 20);
      }
    }
  }, 1000);
}

startGlobalGameLoop();

// ============================================================
// GET
// ============================================================

export async function GET(
  request: Request
) {
  try {
    const {
      searchParams,
    } = new URL(request.url);

    const walletAddress = (
      searchParams.get(
        "walletAddress"
      ) ||
      "global_guest"
    ).trim();

    let balance =
      DEFAULT_GUEST_BALANCE;

    // ======================================================
    // REAL CONNECTED WALLET
    // ======================================================

    if (
      walletAddress !==
      "global_guest"
    ) {
      const {
        data: user,
        error,
      } = await supabaseAdmin
        .from("users")
        .select("vault_balance")
        .ilike(
          "wallet_address",
          walletAddress
        )
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (user) {
        balance =
          Number(
            user.vault_balance
          ) || 0;
      } else {
        const {
          error:
            insertError,
        } = await supabaseAdmin
          .from("users")
          .insert({
            wallet_address:
              walletAddress,
            vault_balance:
              DEFAULT_GUEST_BALANCE,
          });

        if (insertError) {
          throw insertError;
        }

        balance =
          DEFAULT_GUEST_BALANCE;
      }
    }

    // ======================================================
    // CURRENT PLAYER BETS
    // ======================================================

    const currentRoundBets =
      roundBetsMap
        .get(
          globalGameState.roundId
        )
        ?.get(walletAddress) ||
      [];

    // ======================================================
    // GLOBAL EXPOSURE
    // ======================================================

    const exposure =
      getRoundExposure(
        globalGameState.roundId
      );

    // ======================================================
    // HOUSE VAULT BALANCE
    // ======================================================

    let houseVaultBalance = 0;

    try {
      houseVaultBalance =
        await getHouseVaultBalance();
    } catch (vaultError) {
      console.error(
        "House vault GET error:",
        vaultError
      );
    }

    return NextResponse.json({
      success: true,

      balance,

      gameState:
        globalGameState,

      myBets:
        currentRoundBets,

      houseVault: {
        balance:
          houseVaultBalance,

        referenceBankroll:
          HOUSE_BANKROLL_REFERENCE,
      },

      limits: {
        houseBankroll:
          HOUSE_BANKROLL_REFERENCE,

        minBet:
          MIN_BET,

        maxNumberBet:
          MAX_NUMBER_BET,

        maxOutsideBet:
          MAX_OUTSIDE_BET,

        maxDozenBet:
          MAX_DOZEN_BET,

        maxColumnBet:
          MAX_COLUMN_BET,

        maxPlayerRoundExposure:
          MAX_PLAYER_ROUND_EXPOSURE,

        maxGlobalRoundExposure:
          MAX_GLOBAL_ROUND_EXPOSURE,

        maxGlobalPayoutLiability:
          MAX_GLOBAL_PAYOUT_LIABILITY,

        currentGlobalExposure:
          exposure.totalBetAmount,

        currentMaximumPayout:
          exposure.maximumPossiblePayout,
      },
    });
  } catch (err: any) {
    console.error(
      "GET error:",
      err
    );

    return NextResponse.json(
      {
        success: false,
        error:
          err?.message ||
          "Failed to fetch roulette state.",
      },
      {
        status: 500,
      }
    );
  }
}

// ============================================================
// DELETE
//
// Clear current player's bets.
//
// Since the player's vault was already deducted,
// clearing refunds the exact wager.
//
// HOUSE VAULT IS NOT TOUCHED.
//
// The house only receives the bet after the round
// actually resolves.
// ============================================================

export async function DELETE(
  request: Request
) {
  try {
    const body =
      await request
        .json()
        .catch(() => ({}));

    const walletAddress = (
      body.walletAddress ||
      "global_guest"
    ).trim();

    // ======================================================
    // BETTING WINDOW
    // ======================================================

    if (
      globalGameState.status !==
        "betting" ||
      globalGameState.countdown <= 2
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Bets can only be cleared while betting is open.",
        },
        {
          status: 400,
        }
      );
    }

    const currentRoundId =
      globalGameState.roundId;

    const roundMap =
      roundBetsMap.get(
        currentRoundId
      );

    if (!roundMap) {
      return NextResponse.json({
        success: true,
        balance:
          walletAddress ===
          "global_guest"
            ? DEFAULT_GUEST_BALANCE
            : undefined,
        refundedAmount: 0,
        myBets: [],
        gameState:
          globalGameState,
      });
    }

    const currentBets =
      roundMap.get(
        walletAddress
      ) || [];

    if (
      currentBets.length === 0
    ) {
      return NextResponse.json({
        success: true,
        balance:
          walletAddress ===
          "global_guest"
            ? DEFAULT_GUEST_BALANCE
            : undefined,
        refundedAmount: 0,
        myBets: [],
        gameState:
          globalGameState,
      });
    }

    // ======================================================
    // REFUND
    // ======================================================

    const refundedAmount =
      currentBets.reduce(
        (
          sum: number,
          bet: Bet
        ) =>
          sum +
          Number(
            bet.amount || 0
          ),
        0
      );

    // ======================================================
    // REAL WALLET
    // ======================================================

    if (
      walletAddress !==
      "global_guest"
    ) {
      const {
        data: user,
        error,
      } = await supabaseAdmin
        .from("users")
        .select("vault_balance")
        .ilike(
          "wallet_address",
          walletAddress
        )
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!user) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Wallet account not found.",
          },
          {
            status: 404,
          }
        );
      }

      const currentBalance =
        Number(
          user.vault_balance
        ) || 0;

      const restoredBalance =
        currentBalance +
        refundedAmount;

      const {
        error:
          updateError,
      } = await supabaseAdmin
        .from("users")
        .update({
          vault_balance:
            restoredBalance,
        })
        .ilike(
          "wallet_address",
          walletAddress
        );

      if (updateError) {
        throw updateError;
      }

      // Remove bets before resolution.
      roundMap.delete(
        walletAddress
      );

      if (
        roundMap.size === 0
      ) {
        roundBetsMap.delete(
          currentRoundId
        );
      }

      return NextResponse.json({
        success: true,

        balance:
          restoredBalance,

        refundedAmount,

        myBets: [],

        gameState:
          globalGameState,
      });
    }

    // ======================================================
    // GUEST
    // ======================================================

    roundMap.delete(
      walletAddress
    );

    if (
      roundMap.size === 0
    ) {
      roundBetsMap.delete(
        currentRoundId
      );
    }

    return NextResponse.json({
      success: true,

      balance:
        DEFAULT_GUEST_BALANCE,

      refundedAmount,

      myBets: [],

      gameState:
        globalGameState,
    });
  } catch (err: any) {
    console.error(
      "DELETE error:",
      err
    );

    return NextResponse.json(
      {
        success: false,
        error:
          err?.message ||
          "Failed to clear bets.",
      },
      {
        status: 500,
      }
    );
  }
}

// ============================================================
// POST
//
// PLACE BET
// ============================================================

export async function POST(
  request: Request
) {
  try {
    const body =
      await request.json();

    const walletAddress = (
      body.walletAddress ||
      "global_guest"
    ).trim();

    const bets =
      body.bets;

    // ======================================================
    // ROUND STATUS
    // ======================================================

    if (
      globalGameState.status !==
        "betting" ||
      globalGameState.countdown <= 2
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Betting is closed for this round!",
        },
        {
          status: 400,
        }
      );
    }

    // ======================================================
    // BET ARRAY
    // ======================================================

    if (
      !Array.isArray(bets) ||
      bets.length === 0
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No bets provided.",
        },
        {
          status: 400,
        }
      );
    }

    // ======================================================
    // VALIDATE TYPES
    // ======================================================

    for (const bet of bets) {
      if (
        !bet ||
        !VALID_BET_TYPES.has(
          bet.type
        )
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Invalid roulette bet type.",
          },
          {
            status: 400,
          }
        );
      }
    }

    // ======================================================
    // VALIDATE AMOUNTS
    // ======================================================

    for (const bet of bets) {
      const amount =
        Number(
          bet.amount
        );

      if (
        !Number.isFinite(
          amount
        ) ||
        amount <= 0
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Invalid bet amount.",
          },
          {
            status: 400,
          }
        );
      }

      if (
        amount < MIN_BET
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              `Minimum bet is ${MIN_BET.toLocaleString()} tokens.`,
          },
          {
            status: 400,
          }
        );
      }

      const maximum =
        getMaximumBet(
          bet.type
        );

      if (
        amount >
        maximum
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              `Maximum ${bet.type} bet is ${maximum.toLocaleString()} tokens.`,
          },
          {
            status: 400,
          }
        );
      }
    }

    // ======================================================
    // VALIDATE NUMBER
    // ======================================================

    for (const bet of bets) {
      if (
        bet.type !==
        "number"
      ) {
        continue;
      }

      const rawValue =
        bet.value;

      const validNumber =
        rawValue ===
          "00" ||
        (
          typeof rawValue ===
            "number" &&
          Number.isInteger(
            rawValue
          ) &&
          rawValue >= 0 &&
          rawValue <= 36
        ) ||
        (
          typeof rawValue ===
            "string" &&
          rawValue !== "" &&
          /^\d+$/.test(
            rawValue
          ) &&
          Number.isInteger(
            Number(
              rawValue
            )
          ) &&
          Number(
            rawValue
          ) >= 0 &&
          Number(
            rawValue
          ) <= 36
        );

      if (
        !validNumber
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Invalid roulette number bet.",
          },
          {
            status: 400,
          }
        );
      }
    }

    // ======================================================
    // CURRENT ROUND
    // ======================================================

    const currentRoundId =
      globalGameState.roundId;

    if (
      !roundBetsMap.has(
        currentRoundId
      )
    ) {
      roundBetsMap.set(
        currentRoundId,
        new Map()
      );
    }

    const roundMap =
      roundBetsMap.get(
        currentRoundId
      )!;

    const existingBets =
      roundMap.get(
        walletAddress
      ) || [];

    // ======================================================
    // MERGE EXISTING + NEW BETS
    // ======================================================

    const updatedBets =
      existingBets.map(
        (bet) => ({
          ...bet,
        })
      );

    for (
      const newBet of bets
    ) {
      const normalizedBet =
        newBet.type ===
          "number" &&
        newBet.value !==
          "00"
          ? {
              ...newBet,
              value:
                Number(
                  newBet.value
                ),
            }
          : {
              ...newBet,
            };

      const existingIndex =
        updatedBets.findIndex(
          (existing) =>
            existing.type ===
              normalizedBet.type &&
            String(
              existing.value
            ) ===
              String(
                normalizedBet.value
              ) &&
            existing.dozenIndex ===
              normalizedBet.dozenIndex &&
            existing.columnIndex ===
              normalizedBet.columnIndex
        );

      if (
        existingIndex >= 0
      ) {
        updatedBets[
          existingIndex
        ] = {
          ...updatedBets[
            existingIndex
          ],

          amount:
            Number(
              updatedBets[
                existingIndex
              ].amount
            ) +
            Number(
              normalizedBet.amount
            ),
        };
      } else {
        updatedBets.push(
          normalizedBet
        );
      }
    }

    // ======================================================
    // COMBINED INDIVIDUAL LIMITS
    // ======================================================

    for (
      const bet of updatedBets
    ) {
      const amount =
        Number(
          bet.amount
        );

      const maximum =
        getMaximumBet(
          bet.type
        );

      if (
        amount >
        maximum
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              `Maximum ${bet.type} bet is ${maximum.toLocaleString()} tokens.`,
          },
          {
            status: 400,
          }
        );
      }
    }

    // ======================================================
    // PLAYER ROUND EXPOSURE
    // ======================================================

    const playerRoundExposure =
      updatedBets.reduce(
        (
          sum: number,
          bet: Bet
        ) =>
          sum +
          Number(
            bet.amount || 0
          ),
        0
      );

    if (
      playerRoundExposure >
      MAX_PLAYER_ROUND_EXPOSURE
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            `Maximum round exposure is ${MAX_PLAYER_ROUND_EXPOSURE.toLocaleString()} tokens.`,
        },
        {
          status: 400,
        }
      );
    }

    // ======================================================
    // OTHER PLAYERS
    // ======================================================

    let otherPlayersExposure =
      0;

    const otherPlayerBets: Bet[] =
      [];

    for (
      const [
        otherWallet,
        otherBets,
      ] of roundMap.entries()
    ) {
      if (
        otherWallet ===
        walletAddress
      ) {
        continue;
      }

      for (
        const bet of otherBets
      ) {
        otherPlayersExposure +=
          Number(
            bet.amount || 0
          );

        otherPlayerBets.push(
          bet
        );
      }
    }

    // ======================================================
    // GLOBAL ROUND EXPOSURE
    // ======================================================

    const globalRoundExposure =
      otherPlayersExposure +
      playerRoundExposure;

    if (
      globalRoundExposure >
      MAX_GLOBAL_ROUND_EXPOSURE
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            `Global round betting limit is ${MAX_GLOBAL_ROUND_EXPOSURE.toLocaleString()} tokens.`,
        },
        {
          status: 400,
        }
      );
    }

    // ======================================================
    // MAXIMUM POSSIBLE PAYOUT
    // ======================================================

    let maximumPossiblePayout =
      0;

    for (
      const possibleNumber of
        ROULETTE_WHEEL_SEQUENCE
    ) {
      let payoutForNumber =
        0;

      // Other players
      for (
        const bet of
          otherPlayerBets
      ) {
        if (
          checkBetWin(
            bet,
            possibleNumber
          )
        ) {
          payoutForNumber +=
            getPotentialPayout(
              bet
            );
        }
      }

      // Current player
      for (
        const bet of
          updatedBets
      ) {
        if (
          checkBetWin(
            bet,
            possibleNumber
          )
        ) {
          payoutForNumber +=
            getPotentialPayout(
              bet
            );
        }
      }

      if (
        payoutForNumber >
        maximumPossiblePayout
      ) {
        maximumPossiblePayout =
          payoutForNumber;
      }
    }

    // ======================================================
    // HOUSE LIABILITY LIMIT
    // ======================================================

    if (
      maximumPossiblePayout >
      MAX_GLOBAL_PAYOUT_LIABILITY
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            `This bet would exceed the casino's ${MAX_GLOBAL_PAYOUT_LIABILITY.toLocaleString()} token maximum payout exposure.`,
        },
        {
          status: 400,
        }
      );
    }

    // ======================================================
    // AMOUNT ADDED BY THIS REQUEST
    // ======================================================

    const totalBetAmount =
      bets.reduce(
        (
          sum: number,
          bet: Bet
        ) =>
          sum +
          Number(
            bet.amount
          ),
        0
      );

    // ======================================================
    // FETCH PLAYER VAULT
    // ======================================================

    let currentBalance =
      DEFAULT_GUEST_BALANCE;

    if (
      walletAddress !==
      "global_guest"
    ) {
      const {
        data: user,
        error,
      } = await supabaseAdmin
        .from("users")
        .select("vault_balance")
        .ilike(
          "wallet_address",
          walletAddress
        )
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!user) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Wallet account not found.",
          },
          {
            status: 404,
          }
        );
      }

      currentBalance =
        Number(
          user.vault_balance
        ) || 0;
    }

    // ======================================================
    // PLAYER BALANCE CHECK
    // ======================================================

    if (
      currentBalance <
      totalBetAmount
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Insufficient vault balance!",
        },
        {
          status: 400,
        }
      );
    }

    // ======================================================
    // NEW PLAYER BALANCE
    // ======================================================

    const newBalance =
      currentBalance -
      totalBetAmount;

    // ======================================================
    // DEDUCT FROM PLAYER VAULT
    //
    // HOUSE DOES NOT RECEIVE THE BET YET.
    //
    // It receives it only when the round resolves.
    // This makes CLEAR BETS safe.
    // ======================================================

    if (
      walletAddress !==
      "global_guest"
    ) {
      const {
        error:
          updateError,
      } = await supabaseAdmin
        .from("users")
        .update({
          vault_balance:
            newBalance,
        })
        .ilike(
          "wallet_address",
          walletAddress
        );

      if (updateError) {
        throw updateError;
      }
    }

    // ======================================================
    // SAVE BETS
    // ======================================================

    roundMap.set(
      walletAddress,
      updatedBets
    );

    // ======================================================
    // RETURN
    // ======================================================

    return NextResponse.json({
      success: true,

      newBalance,

      gameState:
        globalGameState,

      myBets:
        updatedBets,

      limits: {
        houseBankroll:
          HOUSE_BANKROLL_REFERENCE,

        playerRoundExposure:
          playerRoundExposure,

        globalRoundExposure:
          globalRoundExposure,

        maximumPossiblePayout:
          maximumPossiblePayout,
      },
    });
  } catch (err: any) {
    console.error(
      "POST error:",
      err
    );

    return NextResponse.json(
      {
        success: false,
        error:
          err?.message ||
          "Failed to place roulette bet.",
      },
      {
        status: 500,
      }
    );
  }
}