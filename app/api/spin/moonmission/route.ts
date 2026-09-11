
import { NextResponse } from "next/server";
import { acquireLock, releaseLock } from "@/utils/lock";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  generateGameOutcome,
  hashServerSeed,
  generateRandomServerSeed,
} from "@/utils/serverProvablyFair";

const GAME_NAME = "Moon Mission";

// ============================================================
// HOUSE VAULT
// ============================================================

const HOUSE_VAULT_ID = 1;

async function getHouseVaultBalance(): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("house_vault")
    .select("balance")
    .eq("id", HOUSE_VAULT_ID)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("House vault row id=1 was not found.");
  }

  return Number(data.balance) || 0;
}

// Positive = house gains
// Negative = house pays
async function changeHouseVault(amount: number): Promise<number> {
  const currentBalance = await getHouseVaultBalance();
  const newBalance = currentBalance + amount;

  if (newBalance < 0) {
    throw new Error(
      `House vault has insufficient balance. Current: ${currentBalance}, required: ${Math.abs(
        amount
      )}`
    );
  }

  const { data, error } = await supabaseAdmin
    .from("house_vault")
    .update({
      balance: newBalance,
      updated_at: new Date().toISOString(),
    })
    .eq("id", HOUSE_VAULT_ID)
    .select("balance")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("House vault was not updated.");
  }

  return Number(data.balance) || 0;
}

// ============================================================
// SYMBOL WEIGHTS
// ============================================================

const SYMBOL_WEIGHTS: Record<string, number> = {
  "rug.png": 60,
  "hodl.png": 55,
  "bag.png": 45,
  "green.png": 35,
  "fuel.png": 25,
  "bonding.png": 18,
  "sol.png": 10,
  "koth.png": 6,
  "diamond.png": 4,
  "wild.png": 3,
  "scatter.png": 3,
};

// ============================================================
// PAYTABLE
// ============================================================

const PAYTABLE: Record<
  string,
  { 3: number; 4: number; 5: number }
> = {
  "diamond.png": {
    3: 1.5,
    4: 3.0,
    5: 6.0,
  },

  "koth.png": {
    3: 1.3,
    4: 2.5,
    5: 5.0,
  },

  "sol.png": {
    3: 1.1,
    4: 2.2,
    5: 4.5,
  },

  "bonding.png": {
    3: 1.0,
    4: 2.0,
    5: 4.0,
  },

  "fuel.png": {
    3: 0.8,
    4: 1.6,
    5: 3.5,
  },

  "green.png": {
    3: 0.6,
    4: 1.4,
    5: 3.0,
  },

  "bag.png": {
    3: 0.5,
    4: 1.2,
    5: 2.5,
  },

  "hodl.png": {
    3: 0.4,
    4: 1.0,
    5: 2.0,
  },

  "rug.png": {
    3: 0.3,
    4: 0.8,
    5: 1.5,
  },
};

// ============================================================
// PAYLINES
// ============================================================

const PAYLINES: number[][] = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2],
  [1, 0, 1, 0, 1],
  [1, 2, 1, 2, 1],
  [0, 1, 0, 1, 0],
  [2, 1, 2, 1, 2],
  [0, 0, 1, 0, 0],
  [2, 2, 1, 2, 2],
  [1, 1, 0, 1, 1],
  [1, 1, 2, 1, 1],
  [0, 2, 0, 2, 0],
];

const PAYLINE_COLORS = [
  "#f59e0b",
  "#3b82f6",
  "#ec4899",
  "#10b981",
  "#8b5cf6",
  "#ef4444",
  "#06b6d4",
  "#f97316",
  "#84cc16",
  "#a855f7",
];

// ============================================================
// TYPES
// ============================================================

interface Cell {
  id: string;
  symbol: string;
  isGold: boolean;
  multiplier: number;
  isWild: boolean;
  isScatter: boolean;
}

interface WinningLineResponse {
  lineIndex: number;
  coords: {
    col: number;
    row: number;
  }[];
  color: string;
}

interface CascadeStep {
  grid: Cell[][];
  winningLines: WinningLineResponse[];
  stepPayout: number;
  multiplierSnapshot: number;
}

// ============================================================
// RANDOM SYMBOL
// ============================================================

const getRandomWeightedSymbol = (randVal: number): string => {
  const entries = Object.entries(SYMBOL_WEIGHTS);

  const totalWeight = entries.reduce(
    (sum, [, weight]) => sum + weight,
    0
  );

  let randomNum = randVal * totalWeight;

  for (const [symbol, weight] of entries) {
    if (randomNum < weight) {
      return symbol;
    }

    randomNum -= weight;
  }

  return "rug.png";
};

// ============================================================
// RANDOM MULTIPLIER
// ============================================================

function getRandomMultiplier(
  rand: number,
  isFreeSpin: boolean
): number {
  if (!isFreeSpin) {
    if (rand < 0.55) return 2;
    if (rand < 0.8) return 3;
    if (rand < 0.95) return 5;

    return 10;
  }

  if (rand < 0.35) return 2;
  if (rand < 0.6) return 3;
  if (rand < 0.8) return 5;
  if (rand < 0.9) return 10;
  if (rand < 0.95) return 15;
  if (rand < 0.98) return 20;

  return 25;
}

// ============================================================
// GET
// ============================================================

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const walletAddress =
      url.searchParams.get("walletAddress");

    if (!walletAddress) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing wallet address",
        },
        {
          status: 400,
        }
      );
    }

    const cleanWallet =
      walletAddress.trim().toLowerCase();

    const {
      data: user,
      error,
    } = await supabaseAdmin
      .from("users")
      .select(
        "vault_balance, free_spins_left, free_spin_game, current_multiplier, bet_amount, total_bonus_win"
      )
      .ilike(
        "wallet_address",
        cleanWallet
      )
      .maybeSingle();

    if (error || !user) {
      return NextResponse.json(
        {
          success: false,
          error: "User profile not found",
        },
        {
          status: 404,
        }
      );
    }

    const isCurrentGameActive =
      user.free_spin_game === GAME_NAME;

    return NextResponse.json({
      success: true,

      balance:
        Number(user.vault_balance) || 0,

      freeSpinsLeft:
        isCurrentGameActive
          ? Number(user.free_spins_left) || 0
          : 0,

      freeSpinGame:
        user.free_spin_game || null,

      currentMultiplier:
        isCurrentGameActive
          ? Number(user.current_multiplier) || 1
          : 1,

      betAmount:
        isCurrentGameActive
          ? Number(user.bet_amount) || 20
          : 20,

      totalBonusWin:
        isCurrentGameActive
          ? Number(user.total_bonus_win) || 0
          : 0,
    });
  } catch (err) {
    console.error(
      "GET session hydration error:",
      err
    );

    return NextResponse.json(
      {
        success: false,
        error: "Internal Server Error",
      },
      {
        status: 500,
      }
    );
  }
}

// ============================================================
// POST
// ============================================================

export async function POST(req: Request) {
  let walletAddress: string | null = null;

  try {
    const body = await req.json();

    walletAddress = body.walletAddress
      ? String(body.walletAddress).trim()
      : null;

    const {
      betAmount,
      buyType,
      isFreeSpin,
      currentMultiplier,
    } = body;

    const parsedBet = Number(betAmount);

    if (
      !walletAddress ||
      isNaN(parsedBet) ||
      parsedBet <= 0
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid parameters or wallet address",
        },
        {
          status: 400,
        }
      );
    }

    // ========================================================
    // LOCK WALLET
    // ========================================================

    const acquired =
      await acquireLock(walletAddress);

    if (!acquired) {
      return NextResponse.json(
        {
          success: false,
          error: "Concurrent spin blocked",
        },
        {
          status: 429,
        }
      );
    }

    try {
      // ======================================================
      // FETCH USER
      // ======================================================

      const {
        data: user,
        error: userError,
      } = await supabaseAdmin
        .from("users")
        .select(
          "vault_balance, free_spins_left, free_spin_game, current_multiplier, bet_amount, total_bonus_win"
        )
        .ilike(
          "wallet_address",
          walletAddress
        )
        .maybeSingle();

      if (userError || !user) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Database error fetching user data",
          },
          {
            status: 500,
          }
        );
      }

      const currentBalance =
        Number(user.vault_balance) || 0;

      const storedFreeSpinsLeft =
        Number(user.free_spins_left) || 0;

      const storedBetAmount =
        Number(user.bet_amount) || parsedBet;

      let storedTotalBonusWin =
        Number(user.total_bonus_win) || 0;

      // ======================================================
      // FREE SPIN PROTECTION
      // ======================================================

      if (isFreeSpin) {
        if (
          user.free_spin_game !== GAME_NAME ||
          storedFreeSpinsLeft <= 0
        ) {
          return NextResponse.json(
            {
              success: false,
              error: `Free spins belong to ${
                user.free_spin_game ||
                "another session"
              }. You cannot use them in ${GAME_NAME}.`,
            },
            {
              status: 400,
            }
          );
        }
      }

      // ======================================================
      // CROSS-GAME FREE SPIN PROTECTION
      // ======================================================

      if (
        !isFreeSpin &&
        storedFreeSpinsLeft > 0 &&
        user.free_spin_game &&
        user.free_spin_game !== GAME_NAME
      ) {
        return NextResponse.json(
          {
            success: false,
            error: `You have active free spins in ${user.free_spin_game}. Complete them before playing ${GAME_NAME}.`,
          },
          {
            status: 400,
          }
        );
      }

      // ======================================================
      // ACTIVE BET
      // ======================================================

      const activeBet = isFreeSpin
        ? storedBetAmount
        : parsedBet;

      // ======================================================
      // SPIN COST
      // ======================================================

      let spinCost = 0;

      if (!isFreeSpin) {
        if (buyType === "standard") {
          spinCost = activeBet * 75;
        } else if (buyType === "super") {
          spinCost = activeBet * 200;
        } else {
          spinCost = activeBet;
        }
      }

      // ======================================================
      // PLAYER BALANCE CHECK
      // ======================================================

      if (currentBalance < spinCost) {
        return NextResponse.json(
          {
            success: false,
            error: `Insufficient vault balance. Required: $${spinCost.toFixed(
              2
            )}, Available: $${currentBalance.toFixed(
              2
            )}`,
          },
          {
            status: 400,
          }
        );
      }

      // ======================================================
      // PROVABLY FAIR
      // ======================================================

      let {
        data: seedData,
      } = await supabaseAdmin
        .from("player_seeds")
        .select("*")
        .ilike(
          "wallet_address",
          walletAddress
        )
        .maybeSingle();

      let serverSeed: string;
      let clientSeed: string;
      let nonce: number;

      if (!seedData) {
        serverSeed =
          generateRandomServerSeed();

        clientSeed = body.clientSeed
          ? String(body.clientSeed)
          : "default-moon-mission-client";

        nonce = 0;

        const {
          error: seedInsertError,
        } = await supabaseAdmin
          .from("player_seeds")
          .insert({
            wallet_address:
              walletAddress.toLowerCase(),

            server_seed:
              serverSeed,

            server_seed_hash:
              hashServerSeed(serverSeed),

            client_seed:
              clientSeed,

            nonce,
          });

        if (seedInsertError) {
          throw seedInsertError;
        }
      } else {
        serverSeed =
          seedData.server_seed;

        clientSeed = body.clientSeed
          ? String(body.clientSeed)
          : seedData.client_seed;

        nonce =
          Number(seedData.nonce) + 1;
      }

      // ======================================================
      // FAIR RANDOM
      // ======================================================

      let cursor = 0;

      const getFairRandom = () => {
        const val =
          generateGameOutcome(
            serverSeed,
            clientSeed,
            nonce,
            cursor
          );

        cursor++;

        return val;
      };

      // ======================================================
      // CREATE RANDOM CELL
      // ======================================================

      const createRandomCell = (
        col: number,
        row: number
      ): Cell => {
        const rawSymbol =
          getRandomWeightedSymbol(
            getFairRandom()
          );

        const isWild =
          rawSymbol === "wild.png";

        const isScatter =
          rawSymbol === "scatter.png";

        const isTargetReel =
          col >= 1 && col <= 3;

        const hasMultiplier =
          isTargetReel &&
          !isScatter &&
          getFairRandom() < 0.06;

        const goldMultiplier =
          hasMultiplier
            ? getRandomMultiplier(
                getFairRandom(),
                isFreeSpin
              )
            : 0;

        return {
          id: `srv-${col}-${row}-${Date.now()}-${Math.random()}`,

          symbol:
            rawSymbol,

          isGold:
            hasMultiplier,

          multiplier:
            goldMultiplier,

          isWild,

          isScatter,
        };
      };

      // ======================================================
      // INITIAL MULTIPLIER
      // ======================================================

      let runningMultiplier =
        isFreeSpin
          ? Number(currentMultiplier) ||
            Number(user.current_multiplier) ||
            1
          : buyType === "super"
          ? 10
          : 1;

      // ======================================================
      // INITIAL GRID
      // ======================================================

      let grid: Cell[][] =
        Array(5)
          .fill(null)
          .map((_, col) =>
            Array(3)
              .fill(null)
              .map((_, row) =>
                createRandomCell(
                  col,
                  row
                )
              )
          );

      // ======================================================
      // BONUS BUY
      // ======================================================

      if (
        buyType === "standard" ||
        buyType === "super"
      ) {
        const requiredScatters =
          buyType === "super"
            ? getFairRandom() < 0.3
              ? 5
              : 4
            : 3;

        const availableCols =
          [0, 1, 2, 3, 4]
            .sort(
              () =>
                getFairRandom() -
                0.5
            )
            .slice(
              0,
              requiredScatters
            );

        availableCols.forEach(
          (col) => {
            for (
              let r = 0;
              r < 3;
              r++
            ) {
              grid[col][r].isScatter =
                false;

              if (
                grid[col][r].symbol ===
                "scatter.png"
              ) {
                grid[col][r].symbol =
                  "rug.png";
              }
            }

            const targetRow =
              Math.floor(
                getFairRandom() * 3
              );

            grid[col][targetRow] = {
              id: `srv-${col}-${targetRow}-scatter-forced`,

              symbol:
                "scatter.png",

              isGold: false,

              multiplier: 0,

              isWild: false,

              isScatter: true,
            };
          }
        );
      }

      // ======================================================
      // CASCADE
      // ======================================================

      const cascadeSteps:
        CascadeStep[] = [];

      let totalLinePayoutMultiplier =
        0;

      let maxCascades = 8;

      const MAX_ALLOWED_MULTIPLIER =
        100;

      while (maxCascades > 0) {
        maxCascades--;

        const bestLinePayouts =
          new Map<
            number,
            {
              payout: number;
              winningLines:
                WinningLineResponse[];
            }
          >();

        const winningCoordsSet =
          new Set<string>();

        // ==================================================
        // CHECK PAYLINES
        // ==================================================

        PAYLINES.forEach(
          (
            payline,
            lineIdx
          ) => {
            const lineSymbols =
              payline.map(
                (
                  row,
                  col
                ) =>
                  grid[col][row]
              );

            const targetCell =
              lineSymbols.find(
                (cell) =>
                  !cell.isWild &&
                  !cell.isScatter
              );

            const targetSymbol =
              targetCell
                ? targetCell.symbol
                : "diamond.png";

            let matchCount = 0;

            const matchingCoords: {
              col: number;
              row: number;
            }[] = [];

            for (
              let col = 0;
              col <
              lineSymbols.length;
              col++
            ) {
              const cell =
                lineSymbols[col];

              if (
                cell.symbol ===
                  targetSymbol ||
                cell.isWild
              ) {
                matchCount++;

                matchingCoords.push(
                  {
                    col,
                    row: payline[col],
                  }
                );
              } else {
                break;
              }
            }

            if (
              matchCount >= 3 &&
              PAYTABLE[targetSymbol]
            ) {
              const lineMult =
                PAYTABLE[
                  targetSymbol
                ][
                  matchCount as
                    | 3
                    | 4
                    | 5
                ] || 0;

              const existing =
                bestLinePayouts.get(
                  lineIdx
                );

              if (
                !existing ||
                lineMult >
                  existing.payout
              ) {
                bestLinePayouts.set(
                  lineIdx,
                  {
                    payout:
                      lineMult,

                    winningLines: [
                      {
                        lineIndex:
                          lineIdx,

                        coords:
                          matchingCoords,

                        color:
                          PAYLINE_COLORS[
                            lineIdx %
                              PAYLINE_COLORS.length
                          ],
                      },
                    ],
                  }
                );
              }
            }
          }
        );

        // ==================================================
        // ACTIVE WINNING LINES
        // ==================================================

        const activeWinningLines:
          WinningLineResponse[] = [];

        bestLinePayouts.forEach(
          (data) => {
            totalLinePayoutMultiplier +=
              data.payout;

            data.winningLines.forEach(
              (wl) => {
                activeWinningLines.push(
                  wl
                );

                wl.coords.forEach(
                  (c) => {
                    winningCoordsSet.add(
                      `${c.col}-${c.row}`
                    );
                  }
                );
              }
            );
          }
        );

        // ==================================================
        // MULTIPLIERS
        // ==================================================

        if (
          activeWinningLines.length >
          0
        ) {
          const cascadeMultipliers:
            number[] = [];

          winningCoordsSet.forEach(
            (key) => {
              const [
                colStr,
                rowStr,
              ] = key.split("-");

              const cell =
                grid[
                  Number(colStr)
                ][
                  Number(rowStr)
                ];

              if (
                cell &&
                cell.multiplier > 0
              ) {
                cascadeMultipliers.push(
                  cell.multiplier
                );
              }
            }
          );

          if (
            cascadeMultipliers.length >
            0
          ) {
            const awardedMultiplier =
              cascadeMultipliers[
                Math.floor(
                  getFairRandom() *
                    cascadeMultipliers.length
                )
              ];

            runningMultiplier +=
              awardedMultiplier;

            if (
              runningMultiplier >
              MAX_ALLOWED_MULTIPLIER
            ) {
              runningMultiplier =
                MAX_ALLOWED_MULTIPLIER;
            }
          }
        }

        // ==================================================
        // SAVE CASCADE
        // ==================================================

        cascadeSteps.push({
          grid: JSON.parse(
            JSON.stringify(grid)
          ),

          winningLines:
            activeWinningLines,

          stepPayout: 0,

          multiplierSnapshot:
            runningMultiplier,
        });

        // ==================================================
        // NO WIN
        // ==================================================

        if (
          activeWinningLines.length ===
          0
        ) {
          break;
        }

        // ==================================================
        // CASCADE GRID
        // ==================================================

        const newGrid: Cell[][] =
          grid.map(
            (
              colCells,
              colIdx
            ) => {
              const survivingCells:
                Cell[] = [];

              colCells.forEach(
                (
                  cell,
                  rowIdx
                ) => {
                  const isWinning =
                    winningCoordsSet.has(
                      `${colIdx}-${rowIdx}`
                    );

                  if (!isWinning) {
                    survivingCells.push(
                      cell
                    );
                  } else if (
                    cell.isGold
                  ) {
                    survivingCells.push(
                      {
                        ...cell,

                        symbol:
                          "wild.png",

                        isWild:
                          true,

                        isGold:
                          false,

                        multiplier:
                          0,
                      }
                    );
                  }
                }
              );

              const missingCount =
                3 -
                survivingCells.length;

              const topFilledCells:
                Cell[] =
                Array(missingCount)
                  .fill(null)
                  .map(
                    (_, r) =>
                      createRandomCell(
                        colIdx,
                        r
                      )
                  );

              return [
                ...topFilledCells,
                ...survivingCells,
              ];
            }
          );

        grid = newGrid;
      }

      // ======================================================
      // FINAL PAYOUT
      // ======================================================

      const finalActiveMultiplier =
        totalLinePayoutMultiplier >
        0
          ? runningMultiplier
          : 1;

      const baseWinAmount =
        totalLinePayoutMultiplier *
        activeBet;

      const totalPayout =
        baseWinAmount *
        finalActiveMultiplier;

      const finalMultiplier =
        runningMultiplier;

      // ======================================================
      // SCATTER COUNT
      // ======================================================

      let scatterCount = 0;

      cascadeSteps[0]?.grid.forEach(
        (col) => {
          col.forEach(
            (cell) => {
              if (
                cell.isScatter
              ) {
                scatterCount++;
              }
            }
          );
        }
      );

      // ======================================================
      // FREE SPINS
      // ======================================================

      let awardedFreeSpins = 0;

      if (
        scatterCount >= 3
      ) {
        awardedFreeSpins =
          15 +
          (scatterCount - 3) *
            2;
      }

      // ======================================================
      // FREE SPIN STATE
      // ======================================================

      let nextFreeSpinsLeft =
        storedFreeSpinsLeft;

      if (isFreeSpin) {
        nextFreeSpinsLeft =
          Math.max(
            0,
            nextFreeSpinsLeft - 1
          );

        storedTotalBonusWin +=
          totalPayout;
      } else if (
        awardedFreeSpins > 0
      ) {
        storedTotalBonusWin =
          totalPayout;
      } else {
        storedTotalBonusWin = 0;
      }

      if (
        awardedFreeSpins > 0
      ) {
        nextFreeSpinsLeft +=
          awardedFreeSpins;
      }

      const activeFreeSpinsActive =
        nextFreeSpinsLeft > 0;

      const persistedMultiplier =
        activeFreeSpinsActive
          ? finalMultiplier
          : 1;

      const activeFreeSpinGame =
        activeFreeSpinsActive
          ? GAME_NAME
          : null;

      // ======================================================
      // HOUSE ACCOUNTING
      //
      // PAID:
      // house = spinCost - payout
      //
      // FREE:
      // spinCost = 0
      // house = -payout
      // ======================================================

      const houseNetChange =
        spinCost -
        totalPayout;

      // ======================================================
      // PLAYER ACCOUNTING
      // ======================================================

      const newBalance =
        currentBalance -
        spinCost +
        totalPayout;

      // ======================================================
      // UPDATE PLAYER FIRST
      // ======================================================

      const {
        data: updatedUser,
        error: updateError,
      } = await supabaseAdmin
        .from("users")
        .update({
          vault_balance:
            newBalance,

          free_spins_left:
            nextFreeSpinsLeft,

          free_spin_game:
            activeFreeSpinGame,

          current_multiplier:
            persistedMultiplier,

          bet_amount:
            activeBet,

          total_bonus_win:
            activeFreeSpinsActive
              ? storedTotalBonusWin
              : 0,
        })
        .ilike(
          "wallet_address",
          walletAddress
        )
        .select(
          "vault_balance, free_spins_left, free_spin_game, current_multiplier, bet_amount, total_bonus_win"
        )
        .maybeSingle();

      if (updateError) {
        console.error(
          "❌ MOON MISSION PLAYER UPDATE FAILED:",
          updateError
        );

        return NextResponse.json(
          {
            success: false,
            error:
              "Failed to update player vault.",
          },
          {
            status: 500,
          }
        );
      }

      if (!updatedUser) {
        console.error(
          "❌ MOON MISSION PLAYER WAS NOT UPDATED",
          {
            walletAddress,
            currentBalance,
            newBalance,
          }
        );

        return NextResponse.json(
          {
            success: false,
            error:
              "Player vault account could not be updated.",
          },
          {
            status: 500,
          }
        );
      }

      const confirmedPlayerBalance =
        Number(
          updatedUser.vault_balance
        ) || 0;

      // ======================================================
      // HOUSE VAULT
      // ======================================================

      let houseBalanceBefore = 0;
      let houseBalanceAfter = 0;

      try {
        houseBalanceBefore =
          await getHouseVaultBalance();

        // ==================================================
        // HOUSE MUST COVER PAYOUT
        // ==================================================

        if (
          houseNetChange < 0 &&
          houseBalanceBefore <
            Math.abs(
              houseNetChange
            )
        ) {
          console.error(
            "❌ MOON MISSION HOUSE VAULT INSUFFICIENT",
            {
              walletAddress,
              spinCost,
              totalPayout,
              houseBalance:
                houseBalanceBefore,
              required:
                Math.abs(
                  houseNetChange
                ),
            }
          );

          // ================================================
          // ROLLBACK PLAYER
          // ================================================

          const {
            error:
              rollbackError,
          } = await supabaseAdmin
            .from("users")
            .update({
              vault_balance:
                currentBalance,

              free_spins_left:
                storedFreeSpinsLeft,

              free_spin_game:
                user.free_spin_game,

              current_multiplier:
                user.current_multiplier,

              bet_amount:
                user.bet_amount,

              total_bonus_win:
                user.total_bonus_win,
            })
            .ilike(
              "wallet_address",
              walletAddress
            );

          if (rollbackError) {
            console.error(
              "❌ CRITICAL MOON MISSION PLAYER ROLLBACK FAILED:",
              rollbackError
            );
          }

          return NextResponse.json(
            {
              success: false,
              error:
                "House vault does not have enough balance to cover this payout.",
            },
            {
              status: 400,
            }
          );
        }

        // ==================================================
        // UPDATE HOUSE
        // ==================================================

        houseBalanceAfter =
          await changeHouseVault(
            houseNetChange
          );

        console.log(
          "🏦 MOON MISSION HOUSE VAULT UPDATED",
          {
            walletAddress,
            spinCost,
            totalPayout,
            houseNetChange,
            houseBalanceBefore,
            houseBalanceAfter,
          }
        );
      } catch (houseError) {
        console.error(
          "❌ MOON MISSION HOUSE VAULT UPDATE FAILED:",
          houseError
        );

        // ==================================================
        // ROLLBACK PLAYER
        // ==================================================

        try {
          const {
            error:
              rollbackError,
          } = await supabaseAdmin
            .from("users")
            .update({
              vault_balance:
                currentBalance,

              free_spins_left:
                storedFreeSpinsLeft,

              free_spin_game:
                user.free_spin_game,

              current_multiplier:
                user.current_multiplier,

              bet_amount:
                user.bet_amount,

              total_bonus_win:
                user.total_bonus_win,
            })
            .ilike(
              "wallet_address",
              walletAddress
            );

          if (rollbackError) {
            console.error(
              "❌ CRITICAL: MOON MISSION PLAYER ROLLBACK FAILED:",
              rollbackError
            );
          } else {
            console.log(
              "↩️ MOON MISSION PLAYER VAULT ROLLED BACK"
            );
          }
        } catch (
          rollbackException
        ) {
          console.error(
            "❌ CRITICAL ROLLBACK EXCEPTION:",
            rollbackException
          );
        }

        return NextResponse.json(
          {
            success: false,
            error:
              "Failed to update house ledger. Player balance was restored.",
          },
          {
            status: 500,
          }
        );
      }

      // ======================================================
      // UPDATE PLAYER SEED
      // ======================================================

      const {
        error: seedUpdateError,
      } = await supabaseAdmin
        .from("player_seeds")
        .update({
          nonce,
          client_seed:
            clientSeed,
        })
        .ilike(
          "wallet_address",
          walletAddress
        );

      if (seedUpdateError) {
        console.error(
          "⚠️ PLAYER SEED UPDATE FAILED:",
          seedUpdateError
        );
      }

      // ======================================================
      // SAVE SPIN HISTORY
      // ======================================================

      const {
        error: spinHistoryError,
      } = await supabaseAdmin
        .from("spins")
        .insert({
          wallet_address:
            walletAddress,

          game:
            GAME_NAME,

          bet_amount:
            activeBet,

          spin_cost:
            spinCost,

          payout:
            totalPayout,

          final_multiplier:
            finalMultiplier,

          balance_before:
            currentBalance,

          balance_after:
            confirmedPlayerBalance,

          free_spins_awarded:
            awardedFreeSpins,

          buy_type:
            buyType ?? null,

          grid:
            cascadeSteps[0]?.grid ??
            null,

          winning_lines:
            cascadeSteps[0]
              ?.winningLines ??
            null,

          server_seed:
            hashServerSeed(
              serverSeed
            ),

          client_seed:
            clientSeed,

          nonce:
            nonce,

          created_at:
            new Date().toISOString(),
        });

      if (spinHistoryError) {
        console.error(
          "❌ MOON MISSION SPIN HISTORY INSERT FAILED:",
          spinHistoryError
        );

        return NextResponse.json(
          {
            success: false,
            error:
              "Spin completed but history could not be saved.",
            details:
              spinHistoryError.message,
          },
          {
            status: 500,
          }
        );
      }

      // ======================================================
      // RESPONSE
      // ======================================================

      return NextResponse.json({
        success: true,

        grid:
          cascadeSteps[0]?.grid,

        cascadeSteps,

        totalPayout,

        newBalance:
          confirmedPlayerBalance,

        awardedFreeSpins,

        freeSpinsLeft:
          nextFreeSpinsLeft,

        freeSpinGame:
          activeFreeSpinGame,

        finalMultiplier,

        betAmount:
          activeBet,

        totalBonusWin:
          storedTotalBonusWin,

        winningLines:
          cascadeSteps[0]
            ?.winningLines,

        // ==================================================
        // HOUSE LEDGER
        // ==================================================

        houseLedger: {
          balanceBefore:
            houseBalanceBefore,

          balanceAfter:
            houseBalanceAfter,

          netChange:
            houseNetChange,
        },

        // ==================================================
        // PROVABLY FAIR
        // ==================================================

        provablyFair: {
          nonce,

          serverSeedHash:
            hashServerSeed(
              serverSeed
            ),

          clientSeed,
        },
      });
    } catch (err) {
      console.error(
        "Inner Moon Mission spin error:",
        err
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Spin processing failed",
        },
        {
          status: 500,
        }
      );
    } finally {
      if (walletAddress) {
        releaseLock(walletAddress);
      }
    }
  } catch (err) {
    console.error(
      "Unhandled Moon Mission error:",
      err
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Internal Server Error",
      },
      {
        status: 500,
      }
    );
  }
}
