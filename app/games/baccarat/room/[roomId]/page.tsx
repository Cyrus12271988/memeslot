"use client";

import {
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

import Link from "next/link";

// ============================================================
// TYPES
// ============================================================

type BetType = "PLAYER" | "BANKER" | "TIE";

type BaccaratPhase = "BETTING" | "DEALING" | "RESULT";

type Bet = {
  id: number;
  round_id: string;
  wallet_address: string;
  bet_type: BetType;
  amount: number | string;
  created_at: string;
  settled_at?: string | null;
  payout?: number | string;
};

type RoundState = {
  id: number;
  roundId: string;
  status: string;
  phase: BaccaratPhase;

  remainingSeconds: number;
  remainingMs: number;

  revealIndex: number;
  revealSequence: string[];

  bettingEndsAt: string;
  phaseStartedAt: string;

  cards: {
    player: {
      card1: string | null;
      card2: string | null;
      card3: string | null;
    };
    banker: {
      card1: string | null;
      card2: string | null;
      card3: string | null;
    };
  };

  totals: {
    player: number | null;
    banker: number | null;
  };

  result: "PLAYER" | "BANKER" | "TIE" | null;
};

type GlobalTotals = {
  player: number;
  banker: number;
  tie: number;
  total: number;
};

type ShoeState = {
  shoeNumber: number;
  cardsRemaining: number;
  cardsUsed: number;
  totalCards: number;
};

type RoadEntry = {
  result: BetType;
  roundId: string;
  createdAt: string;
};

type RoadCell = {
  result: "PLAYER" | "BANKER";
  ties: number;
};

// ============================================================
// ROOM LIMITS
// ============================================================

type RoomLimits = {
  minBet?: number;
  maxBet?: number;

  playerMinBet?: number;
  playerMaxBet?: number;

  bankerMinBet?: number;
  bankerMaxBet?: number;

  tieMinBet?: number;
  tieMaxBet?: number;

  maxExposure?: number;
};

type RoomInfo = {
  id?: string;
  roomId?: string;
  name?: string;
  label?: string;

  minBet?: number;
  maxBet?: number;

  playerMinBet?: number;
  playerMaxBet?: number;

  bankerMinBet?: number;
  bankerMaxBet?: number;

  tieMinBet?: number;
  tieMaxBet?: number;

  maxExposure?: number;

  limits?: RoomLimits;
};

// ============================================================
// ROOM FALLBACK CONFIG
//
// These are only used if the API doesn't return room metadata.
// The database/API remains the authority for actual enforcement.
// ============================================================

const ROOM_CONFIG: Record<
  string,
  {
    name: string;
    minBet: number;
    maxBet: number;
    maxExposure: number;
  }
> = {
  "room-1": {
    name: "MICRO TABLE",
    minBet: 1_000,
    maxBet: 10_000,
    maxExposure: 20_000,
  },

  "room-2": {
    name: "LOW TABLE",
    minBet: 5_000,
    maxBet: 50_000,
    maxExposure: 100_000,
  },

  "room-3": {
    name: "STANDARD TABLE",
    minBet: 10_000,
    maxBet: 100_000,
    maxExposure: 200_000,
  },

  "room-4": {
    name: "HIGH TABLE",
    minBet: 20_000,
    maxBet: 200_000,
    maxExposure: 400_000,
  },

  "room-5": {
    name: "VIP TABLE",
    minBet: 50_000,
    maxBet: 500_000,
    maxExposure: 1_000_000,
  },

  "room-6": {
    name: "HIGH ROLLER",
    minBet: 100_000,
    maxBet: 1_000_000,
    maxExposure: 2_000_000,
  },

  "room-7": {
    name: "WHALE TABLE",
    minBet: 500_000,
    maxBet: 5_000_000,
    maxExposure: 10_000_000,
  },

  /*
   * Original table.
   */
  "room-8": {
    name: "ROYAL TABLE",
    minBet: 10_000,
    maxBet: 200_000,
    maxExposure: 400_000,
  },
};

// ============================================================
// BET OPTIONS
// ============================================================

function buildBetOptions(min: number, max: number) {
  const values = [
    min,
    Math.round(min * 2.5),
    Math.round(min * 5),
    Math.round(min * 10),
    Math.round(max / 2),
    max,
  ];

  const unique = Array.from(
    new Set(
      values
        .map((value) => Math.round(value))
        .filter((value) => value >= min && value <= max)
    )
  );

  return unique.sort((a, b) => a - b).slice(0, 6);
}

// ============================================================
// HELPERS
// ============================================================

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatCompactNumber(value: number) {
  if (!Number.isFinite(value)) return "0";

  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(0)}K`;
  }

  return formatNumber(value);
}

function formatRoundCode(
  roundId: string | undefined,
  startedAt?: string
) {
  const date = startedAt ? new Date(startedAt) : new Date();

  const dateTime = Number.isNaN(date.getTime())
    ? "BAC"
    : date
        .toLocaleString("en-US", {
          month: "2-digit",
          day: "2-digit",
          year: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
        .replace(",", "");

  const suffix = String(roundId ?? "000000")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-6)
    .padStart(6, "0")
    .toUpperCase();

  return `BAC-${dateTime}-${suffix}`;
}

function shortWallet(wallet: string) {
  if (!wallet) return "Unknown";

  if (wallet.length <= 12) {
    return wallet;
  }

  return `${wallet.slice(0, 5)}...${wallet.slice(-5)}`;
}

function cardIsRed(card: string | null) {
  if (!card) return false;

  return card.includes("♥") || card.includes("♦");
}

// ============================================================
// BIG ROAD
// ============================================================

function buildBigRoad(results: RoadEntry[]) {
  const cells: Array<Array<RoadCell | null>> = [];

  let lastResult: "PLAYER" | "BANKER" | null = null;
  let col = -1;
  let row = 0;

  const ensureColumn = (index: number) => {
    while (cells.length <= index) {
      cells.push(Array(6).fill(null));
    }
  };

  for (const item of results) {
    if (item.result === "TIE") {
      if (col >= 0 && cells[col]?.[row]) {
        cells[col][row]!.ties += 1;
      }

      continue;
    }

    const result = item.result;

    if (lastResult === null) {
      col = 0;
      row = 0;

      ensureColumn(col);

      cells[col][row] = {
        result,
        ties: 0,
      };
    } else if (result === lastResult) {
      let nextRow = row + 1;
      let nextCol = col;

      if (nextRow < 6 && !cells[nextCol]?.[nextRow]) {
        row = nextRow;
      } else {
        nextRow = row;
        nextCol = col + 1;

        while (cells[nextCol]?.[nextRow]) {
          nextCol += 1;
        }

        col = nextCol;
        row = nextRow;
      }

      ensureColumn(col);

      cells[col][row] = {
        result,
        ties: 0,
      };
    } else {
      col += 1;
      row = 0;

      ensureColumn(col);

      while (cells[col]?.[row]) {
        col += 1;
      }

      ensureColumn(col);

      cells[col][row] = {
        result,
        ties: 0,
      };
    }

    lastResult = result;
  }

  return cells.slice(-50);
}

// ============================================================
// ROAD DOT
// ============================================================

function RoadDot({
  type,
  tie = false,
}: {
  type: "PLAYER" | "BANKER";
  tie?: boolean;
}) {
  const base =
    type === "PLAYER"
      ? "border-blue-400 text-blue-300"
      : "border-red-400 text-red-300";

  return (
    <span
      className={[
        "relative inline-flex",
        "h-6 w-6",
        "items-center justify-center",
        "rounded-full border-2",
        "text-[8px] font-black",
        base,
      ].join(" ")}
    >
      {type === "PLAYER" ? "P" : "B"}

      {tie && (
        <span
          className="
            absolute
            -right-1
            -top-1
            flex
            h-3
            min-w-3
            items-center
            justify-center
            rounded-full
            bg-emerald-500
            px-0.5
            text-[6px]
            font-black
            text-black
          "
        >
          T
        </span>
      )}
    </span>
  );
}

// ============================================================
// PLAYING CARD
// ============================================================

function PlayingCard({
  card,
  hidden = false,
  large = false,
}: {
  card: string | null;
  hidden?: boolean;
  large?: boolean;
}) {
  const red = cardIsRed(card);

  if (hidden || !card) {
    return (
      <div
        className={[
          "relative overflow-hidden",
          "flex items-center justify-center",
          "rounded-xl border-2",
          "border-amber-400/60",
          "bg-slate-950",
          "shadow-xl",
          large
            ? "h-28 w-20 sm:h-36 sm:w-24"
            : "h-24 w-16 sm:h-32 sm:w-20",
        ].join(" ")}
      >
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "url('/images/bg/deckbg.png')",
          }}
        />

        <div className="absolute inset-1 rounded-lg border border-amber-300/30" />

        <div
          className="
            relative
            z-10
            rounded-full
            border
            border-amber-300/40
            bg-black/30
            px-2
            py-1
            text-[8px]
            font-black
            uppercase
            tracking-widest
            text-amber-200
            backdrop-blur-sm
          "
        >
          BAC
        </div>
      </div>
    );
  }

  return (
    <div
      className={[
        "relative flex flex-col",
        "justify-between",
        "rounded-xl border-2",
        "border-slate-300",
        "bg-white",
        "shadow-2xl",
        red ? "text-red-600" : "text-slate-950",
        large
          ? "h-28 w-20 p-2 sm:h-36 sm:w-24 sm:p-3"
          : "h-24 w-16 p-2 sm:h-32 sm:w-20",
      ].join(" ")}
    >
      {card.slice(0, -1)}

      <span
        className="
          absolute
          left-1/2
          top-1/2
          -translate-x-1/2
          -translate-y-1/2
          text-3xl
          sm:text-5xl
        "
      >
        {card.slice(-1)}
      </span>

      <span
        className="
          self-end
          rotate-180
          text-sm
          font-black
          leading-none
          sm:text-lg
        "
      >
        {card.slice(0, -1)}
      </span>
    </div>
  );
}

// ============================================================
// BACCARAT TOTAL
// ============================================================

function calculateHandTotal(cards: Array<string | null>) {
  const activeCards = cards.filter(
    (card): card is string => Boolean(card)
  );

  if (activeCards.length === 0) {
    return 0;
  }

  let total = 0;

  for (const card of activeCards) {
    const rank = card.slice(0, -1);

    if (rank === "A") {
      total += 1;
    } else if (
      ["10", "J", "Q", "K"].includes(rank)
    ) {
      total += 0;
    } else {
      total += Number(rank);
    }
  }

  return total % 10;
}

// ============================================================
// MAIN PAGE
// ============================================================

export default function BaccaratRoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = use(params);

  const { publicKey } = useWallet();

  // ==========================================================
  // STATE
  // ==========================================================

  const [round, setRound] =
    useState<RoundState | null>(null);

  const [bets, setBets] = useState<Bet[]>([]);

  const [globalTotals, setGlobalTotals] =
    useState<GlobalTotals>({
      player: 0,
      banker: 0,
      tie: 0,
      total: 0,
    });

  const [roomInfo, setRoomInfo] =
    useState<RoomInfo | null>(null);

  const [selectedBet, setSelectedBet] =
    useState(0);

  const [myBetTotal, setMyBetTotal] = useState({
    player: 0,
    banker: 0,
    tie: 0,
  });

  const [loading, setLoading] =
    useState(true);

  const [betting, setBetting] =
    useState(false);

  const [error, setError] =
    useState("");

  const [lastMessage, setLastMessage] =
    useState("");

  const [vaultBalance, setVaultBalance] =
    useState(0);

  const [copied, setCopied] =
    useState(false);

  const [mounted, setMounted] =
    useState(false);

  const [shoe, setShoe] =
    useState<ShoeState>({
      shoeNumber: 1,
      cardsRemaining: 416,
      cardsUsed: 0,
      totalCards: 416,
    });

  const [roadHistory, setRoadHistory] =
    useState<RoadEntry[]>([]);

  // ==========================================================
  // CLIENT MOUNT
  //
  // Prevents WalletMultiButton hydration mismatch.
  // ==========================================================

  useEffect(() => {
    setMounted(true);
  }, []);

  // ==========================================================
  // FALLBACK ROOM CONFIG
  // ==========================================================

  const fallbackRoom =
    ROOM_CONFIG[roomId] ??
    ROOM_CONFIG["room-8"];

  // ==========================================================
  // RESOLVED ROOM LIMITS
  //
  // API/database values take priority.
  // ==========================================================

  const resolvedLimits = useMemo(() => {
    const apiLimits =
      roomInfo?.limits ?? roomInfo ?? {};

    const minBet =
      Number(
        apiLimits.minBet ??
          fallbackRoom.minBet
      );

    const maxBet =
      Number(
        apiLimits.maxBet ??
          fallbackRoom.maxBet
      );

    const playerMinBet =
      Number(
        apiLimits.playerMinBet ??
          minBet
      );

    const playerMaxBet =
      Number(
        apiLimits.playerMaxBet ??
          maxBet
      );

    const bankerMinBet =
      Number(
        apiLimits.bankerMinBet ??
          minBet
      );

    const bankerMaxBet =
      Number(
        apiLimits.bankerMaxBet ??
          maxBet
      );

    const tieMinBet =
      Number(
        apiLimits.tieMinBet ??
          minBet
      );

    const tieMaxBet =
      Number(
        apiLimits.tieMaxBet ??
          maxBet
      );

    const maxExposure =
      Number(
        apiLimits.maxExposure ??
          fallbackRoom.maxExposure
      );

    return {
      minBet,
      maxBet,

      playerMinBet,
      playerMaxBet,

      bankerMinBet,
      bankerMaxBet,

      tieMinBet,
      tieMaxBet,

      maxExposure,
    };
  }, [roomInfo, fallbackRoom]);

  // ==========================================================
  // BET OPTIONS
  // ==========================================================

  const betOptions = useMemo(
    () =>
      buildBetOptions(
        resolvedLimits.minBet,
        resolvedLimits.maxBet
      ),
    [resolvedLimits.minBet, resolvedLimits.maxBet]
  );

  // ==========================================================
  // INITIAL SELECTED BET
  // ==========================================================

  useEffect(() => {
    if (betOptions.length === 0) {
      setSelectedBet(resolvedLimits.minBet);
      return;
    }

    setSelectedBet((current) => {
      if (
        current >= resolvedLimits.minBet &&
        current <= resolvedLimits.maxBet
      ) {
        return current;
      }

      return betOptions[0];
    });
  }, [
    roomId,
    resolvedLimits.minBet,
    resolvedLimits.maxBet,
    betOptions,
  ]);

  // ==========================================================
  // FETCH VAULT
  // ==========================================================

  const fetchVaultBalanceDirect =
    useCallback(
      async (walletAddress: string) => {
        try {
          const response = await fetch(
            `/api/balance?walletAddress=${encodeURIComponent(
              walletAddress
            )}`,
            {
              cache: "no-store",
            }
          );

          const data = await response.json();

          if (!response.ok) {
            return;
          }

          const value = Number(
            data?.balance ??
              data?.vaultBalance ??
              0
          );

          if (Number.isFinite(value)) {
            setVaultBalance(value);
          }
        } catch (err) {
          console.error(
            "Failed to fetch Baccarat vault balance:",
            err
          );
        }
      },
      []
    );

  useEffect(() => {
    if (!publicKey) {
      setVaultBalance(0);
      return;
    }

    let cancelled = false;

    const fetchVaultBalance =
      async () => {
        try {
          const response = await fetch(
            `/api/balance?walletAddress=${encodeURIComponent(
              publicKey.toBase58()
            )}`,
            {
              cache: "no-store",
            }
          );

          const data = await response.json();

          if (!response.ok) {
            return;
          }

          const value = Number(
            data?.balance ??
              data?.vaultBalance ??
              0
          );

          if (
            !cancelled &&
            Number.isFinite(value)
          ) {
            setVaultBalance(value);
          }
        } catch (err) {
          console.error(
            "Failed to fetch Baccarat vault balance:",
            err
          );
        }
      };

    fetchVaultBalance();

    const interval = setInterval(
      fetchVaultBalance,
      3000
    );

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [publicKey]);

  // ==========================================================
  // FETCH ROOM STATE
  //
  // IMPORTANT:
  // roomId is included in GET.
  // ==========================================================

  const fetchRoomState =
    useCallback(async () => {
      try {
        const response = await fetch(
          `/api/baccarat?roomId=${encodeURIComponent(
            roomId
          )}`,
          {
            method: "GET",
            cache: "no-store",
          }
        );

        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(
            data?.error ??
              "Failed to load Baccarat room."
          );
        }

        setRound(data.round);

        setBets(
          Array.isArray(data.bets)
            ? data.bets
            : []
        );

        setGlobalTotals(
          data.globalTotals ?? {
            player: 0,
            banker: 0,
            tie: 0,
            total: 0,
          }
        );

        setShoe(
          data.shoe ?? {
            shoeNumber: 1,
            cardsRemaining: 416,
            cardsUsed: 0,
            totalCards: 416,
          }
        );

        setRoadHistory(
          Array.isArray(data.roadHistory)
            ? data.roadHistory
            : []
        );

        if (data.room) {
          setRoomInfo(data.room);
        }

        if (data.roomLimits) {
          setRoomInfo((previous) => ({
            ...(previous ?? {}),
            limits: data.roomLimits,
          }));
        }

        setLoading(false);
        setError("");
      } catch (err: any) {
        console.error(
          "Failed to sync Baccarat room:",
          err
        );

        setError(
          err?.message ??
            "Failed to connect to Baccarat dealer."
        );

        setLoading(false);
      }
    }, [roomId]);

  useEffect(() => {
    setLoading(true);
    setRound(null);
    setBets([]);
    setRoadHistory([]);

    fetchRoomState();

    const interval = setInterval(
      fetchRoomState,
      1000
    );

    return () => {
      clearInterval(interval);
    };
  }, [fetchRoomState]);

  // ==========================================================
  // CALCULATE MY BETS
  // ==========================================================

  useEffect(() => {
    if (!publicKey) {
      setMyBetTotal({
        player: 0,
        banker: 0,
        tie: 0,
      });

      return;
    }

    const wallet =
      publicKey.toBase58();

    const totals = {
      player: 0,
      banker: 0,
      tie: 0,
    };

    for (const bet of bets) {
      if (
        bet.wallet_address !== wallet
      ) {
        continue;
      }

      const amount =
        Number(bet.amount) || 0;

      if (
        bet.bet_type === "PLAYER"
      ) {
        totals.player += amount;
      }

      if (
        bet.bet_type === "BANKER"
      ) {
        totals.banker += amount;
      }

      if (
        bet.bet_type === "TIE"
      ) {
        totals.tie += amount;
      }
    }

    setMyBetTotal(totals);
  }, [bets, publicKey]);

  // ==========================================================
  // PLACE BET
  // ==========================================================

  const placeBet =
    useCallback(
      async (betType: BetType) => {
        if (!publicKey) {
          setError(
            "Connect your wallet first."
          );
          return;
        }

        if (!round) {
          return;
        }

        if (
          round.phase !== "BETTING"
        ) {
          setError(
            "Betting is currently closed."
          );
          return;
        }

        if (
          selectedBet <= 0
        ) {
          setError(
            "Select a valid bet amount."
          );
          return;
        }

        if (
          selectedBet > vaultBalance
        ) {
          setError(
            "Insufficient Vault balance."
          );
          return;
        }

        const limits =
          resolvedLimits;

        const min =
          betType === "PLAYER"
            ? limits.playerMinBet
            : betType === "BANKER"
              ? limits.bankerMinBet
              : limits.tieMinBet;

        const max =
          betType === "PLAYER"
            ? limits.playerMaxBet
            : betType === "BANKER"
              ? limits.bankerMaxBet
              : limits.tieMaxBet;

        if (selectedBet < min) {
          setError(
            `${betType} minimum bet is ${formatNumber(
              min
            )}.`
          );
          return;
        }

        if (selectedBet > max) {
          setError(
            `${betType} maximum bet is ${formatNumber(
              max
            )}.`
          );
          return;
        }

        setBetting(true);
        setError("");
        setLastMessage("");

        try {
          const response =
            await fetch(
              "/api/baccarat",
              {
                method: "POST",
                headers: {
                  "Content-Type":
                    "application/json",
                },
                body: JSON.stringify({
                  action: "bet",

                  roomId,

                  walletAddress:
                    publicKey.toBase58(),

                  betType,

                  amount:
                    selectedBet,
                }),
              }
            );

          const data =
            await response.json();

          if (
            !response.ok ||
            !data.success
          ) {
            throw new Error(
              data?.error ??
                "Bet failed."
            );
          }

          const newBalance =
            Number(
              data?.vaultBalance ??
                data?.balance
            );

          if (
            Number.isFinite(
              newBalance
            )
          ) {
            setVaultBalance(
              newBalance
            );
          }

          setLastMessage(
            `${betType} bet placed: ${formatNumber(
              selectedBet
            )}`
          );

          await Promise.all([
            fetchRoomState(),
            fetchVaultBalanceDirect(
              publicKey.toBase58()
            ),
          ]);
        } catch (err: any) {
          console.error(
            "Baccarat bet error:",
            err
          );

          setError(
            err?.message ??
              "Failed to place bet."
          );
        } finally {
          setBetting(false);
        }
      },
      [
        publicKey,
        round,
        selectedBet,
        vaultBalance,
        roomId,
        resolvedLimits,
        fetchRoomState,
        fetchVaultBalanceDirect,
      ]
    );

  // ==========================================================
  // VISIBLE CARDS
  // ==========================================================

  const visibleCards =
    useMemo(() => {
      const empty = {
        player: {
          card1: null,
          card2: null,
          card3: null,
        },
        banker: {
          card1: null,
          card2: null,
          card3: null,
        },
      };

      if (
        !round ||
        round.phase === "BETTING"
      ) {
        return empty;
      }

      const sequence =
        round.revealSequence ?? [];

      const revealIndex =
        round.revealIndex;

      const isVisible = (
        key: string
      ) => {
        const index =
          sequence.indexOf(key);

        return (
          index !== -1 &&
          revealIndex >= index
        );
      };

      return {
        player: {
          card1: isVisible(
            "player_card_1"
          )
            ? round.cards.player
                .card1
            : null,

          card2: isVisible(
            "player_card_2"
          )
            ? round.cards.player
                .card2
            : null,

          card3:
            round.cards.player
              .card3 &&
            isVisible(
              "player_card_3"
            )
              ? round.cards.player
                  .card3
              : null,
        },

        banker: {
          card1: isVisible(
            "banker_card_1"
          )
            ? round.cards.banker
                .card1
            : null,

          card2: isVisible(
            "banker_card_2"
          )
            ? round.cards.banker
                .card2
            : null,

          card3:
            round.cards.banker
              .card3 &&
            isVisible(
              "banker_card_3"
            )
              ? round.cards.banker
                  .card3
              : null,
        },
      };
    }, [round]);

  // ==========================================================
  // VISIBLE TOTALS
  // ==========================================================

  const visiblePlayerTotal =
    useMemo(
      () =>
        calculateHandTotal([
          visibleCards.player
            .card1,
          visibleCards.player
            .card2,
          visibleCards.player
            .card3,
        ]),
      [visibleCards]
    );

  const visibleBankerTotal =
    useMemo(
      () =>
        calculateHandTotal([
          visibleCards.banker
            .card1,
          visibleCards.banker
            .card2,
          visibleCards.banker
            .card3,
        ]),
      [visibleCards]
    );

  // ==========================================================
  // DEALING MESSAGE
  // ==========================================================

  const dealingMessage =
    useMemo(() => {
      if (
        !round ||
        round.phase !==
          "DEALING"
      ) {
        return "";
      }

      const index =
        round.revealIndex;

      const sequence =
        round.revealSequence ?? [];

      const key =
        sequence[index];

      if (
        key ===
          "player_card_1" ||
        key ===
          "player_card_2"
      ) {
        return "PLAYER CARD";
      }

      if (
        key ===
          "banker_card_1" ||
        key ===
          "banker_card_2"
      ) {
        return "BANKER CARD";
      }

      if (
        key ===
        "player_card_3"
      ) {
        return "PLAYER THIRD CARD";
      }

      if (
        key ===
        "banker_card_3"
      ) {
        return "BANKER THIRD CARD";
      }

      return "DEALING";
    }, [round]);

  // ==========================================================
  // ROOM DISPLAY NAME
  // ==========================================================

  const roomName =
    roomInfo?.name ??
    roomInfo?.label ??
    fallbackRoom.name;

  // ==========================================================
  // PLAYER BETS SHOWN DIRECTLY ON THE BETTING PANELS
  // ==========================================================

  const playerBets = useMemo(
    () => bets.filter((bet) => bet.bet_type === "PLAYER"),
    [bets]
  );

  const bankerBets = useMemo(
    () => bets.filter((bet) => bet.bet_type === "BANKER"),
    [bets]
  );

  const tieBets = useMemo(
    () => bets.filter((bet) => bet.bet_type === "TIE"),
    [bets]
  );

  const renderPanelBets = (
    panelBets: Bet[],
    accent: "PLAYER" | "BANKER" | "TIE"
  ) => (
    <div className="relative z-10 mt-3 rounded-xl border border-slate-800/80 bg-black/25 p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[7px] font-black uppercase tracking-[0.18em] text-slate-500">
          {accent} bets
        </div>
        <div className="text-[8px] font-black tabular-nums text-slate-400">
          {panelBets.length} {panelBets.length === 1 ? "bet" : "bets"}
        </div>
      </div>

      {panelBets.length === 0 ? (
        <div className="py-2 text-center text-[8px] font-bold text-slate-600">
          No bets yet
        </div>
      ) : (
        <div className="max-h-28 space-y-1.5 overflow-y-auto pr-1">
          {panelBets.map((bet) => (
            <div
              key={`${accent}-${bet.id}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-800/70 bg-slate-950/70 px-2 py-1.5"
            >
              <div className="min-w-0 truncate text-[9px] font-bold text-slate-300">
                {shortWallet(bet.wallet_address)}
              </div>

              <div
                className={[
                  "shrink-0 text-[9px] font-black tabular-nums",
                  accent === "PLAYER"
                    ? "text-blue-300"
                    : accent === "BANKER"
                      ? "text-red-300"
                      : "text-emerald-300",
                ].join(" ")}
              >
                {formatNumber(Number(bet.amount) || 0)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ==========================================================
  // BET BUTTON
  // ==========================================================

  const BetButton = ({
    type,
    label,
  }: {
    type: BetType;
    label: string;
  }) => {
    const disabled =
      !publicKey ||
      !round ||
      round.phase !==
        "BETTING" ||
      betting;

    const key =
      type === "PLAYER"
        ? "player"
        : type === "BANKER"
          ? "banker"
          : "tie";

    const myTotal =
      myBetTotal[key];

    const min =
      type === "PLAYER"
        ? resolvedLimits.playerMinBet
        : type === "BANKER"
          ? resolvedLimits.bankerMinBet
          : resolvedLimits.tieMinBet;

    const max =
      type === "PLAYER"
        ? resolvedLimits.playerMaxBet
        : type === "BANKER"
          ? resolvedLimits.bankerMaxBet
          : resolvedLimits.tieMaxBet;

    const belowMin =
      selectedBet < min;

    const aboveMax =
      selectedBet > max;

    const insufficient =
      selectedBet >
      vaultBalance;

    const invalid =
      belowMin ||
      aboveMax ||
      insufficient;

    let status =
      "Click to bet";

    if (insufficient) {
      status =
        "Insufficient Vault";
    } else if (belowMin) {
      status = `MIN ${formatCompactNumber(
        min
      )}`;
    } else if (aboveMax) {
      status = `MAX ${formatCompactNumber(
        max
      )}`;
    }

    return (
      <button
        type="button"
        disabled={
          disabled ||
          invalid
        }
        onClick={() =>
          placeBet(type)
        }
        className={[
          "group relative overflow-hidden",
          "rounded-xl border",
          "p-2.5",
          "transition-all duration-200",
          "disabled:cursor-not-allowed",
          "disabled:opacity-40",

          type === "PLAYER"
            ? "border-blue-400/40 bg-blue-950/50 hover:border-blue-300 hover:bg-blue-900/60"
            : "",

          type === "BANKER"
            ? "border-red-400/40 bg-red-950/50 hover:border-red-300 hover:bg-red-900/60"
            : "",

          type === "TIE"
            ? "border-emerald-400/40 bg-emerald-950/50 hover:border-emerald-300 hover:bg-emerald-900/60"
            : "",
        ].join(" ")}
      >
        <div className="relative z-10">
          <div className="text-sm font-black tracking-wide">
            {label}
          </div>

          <div className="mt-1 text-[8px] font-bold text-slate-400">
            MY BET
          </div>

          <div className="text-xs font-bold text-white">
            {formatNumber(
              myTotal
            )}
          </div>

          <div className="mt-1.5 text-[8px] uppercase tracking-widest text-slate-500">
            {status}
          </div>
        </div>
      </button>
    );
  };

  // ==========================================================
  // LOADING
  // ==========================================================

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 text-white">
        <div className="flex min-h-screen items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="text-4xl">
              🃏
            </div>

            <div className="text-sm font-bold text-slate-300">
              Connecting to{" "}
              {roomName}...
            </div>

            <div className="text-[9px] uppercase tracking-widest text-slate-600">
              Room {roomId}
            </div>
          </div>
        </div>
      </main>
    );
  }

  // ==========================================================
  // BIG ROAD
  // ==========================================================

  const bigRoad =
    buildBigRoad(
      roadHistory
    );

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto w-full max-w-7xl px-2 pb-4 sm:px-3">

        {/* ================================================== */}
        {/* HEADER */}
        {/* ================================================== */}

        <header className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/95 p-2 shadow-2xl shadow-black/40">

          <div className="flex min-w-0 items-center gap-1">

            <Link
              href="/games/baccarat"
              className="shrink-0 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-[10px] font-bold text-slate-300 transition hover:border-amber-400 hover:text-amber-400"
            >
              ← Rooms
            </Link>

            <button
              onClick={() => {
                navigator.clipboard.writeText(
                  "FhgGyS6mC4ZFd2KG5hJLGbiz7skgBaL7fkg2J79upump"
                );

                setCopied(true);

                setTimeout(
                  () =>
                    setCopied(false),
                  2000
                );
              }}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-700/60 bg-slate-950/80 px-2.5 py-1 text-xs font-bold text-slate-300 shadow-md transition-all hover:bg-slate-800/90 hover:text-amber-400 active:scale-95"
            >
              {copied
                ? "✅ Copied!"
                : "📋 Copy CA"}
            </button>

            <div className="hidden min-w-0 md:block">
              <div className="truncate text-sm font-black tracking-tight">
                MEME CASINO BACCARAT
              </div>

              <div className="text-[7px] uppercase tracking-[0.22em] text-amber-400">
                Live Dealer
              </div>
            </div>

          </div>

          {/* ROOM BADGE */}

          <div className="hidden items-center gap-2 lg:flex">
            <div className="rounded-lg border border-amber-400/20 bg-amber-950/20 px-3 py-1.5 text-center">
              <div className="text-[7px] font-black uppercase tracking-widest text-amber-500">
                Room
              </div>

              <div className="text-xs font-black text-amber-200">
                {roomName}
              </div>
            </div>

            <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-center">
              <div className="text-[7px] font-black uppercase tracking-widest text-slate-500">
                Range
              </div>

              <div className="text-xs font-black text-white">
                {formatCompactNumber(
                  resolvedLimits.minBet
                )}
                {" – "}
                {formatCompactNumber(
                  resolvedLimits.maxBet
                )}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">

            <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/40 px-2 py-1.5 text-right">
              <div className="text-[7px] font-bold uppercase tracking-widest text-emerald-500">
                Vault
              </div>

              <div className="text-[10px] font-black tabular-nums text-emerald-300 sm:text-xs">
                {formatNumber(
                  vaultBalance
                )}
              </div>
            </div>

            {mounted ? (
              <WalletMultiButton />
            ) : (
              <div className="h-[40px] w-[145px] rounded-lg border border-slate-700 bg-slate-900" />
            )}

          </div>
        </header>

        {/* MOBILE ROOM BADGE */}

        <div className="mb-2 grid grid-cols-2 gap-1.5 lg:hidden">

          <div className="rounded-lg border border-amber-400/20 bg-amber-950/20 px-2 py-1.5 text-center">
            <div className="text-[7px] font-black uppercase tracking-widest text-amber-500">
              {roomName}
            </div>

            <div className="text-[10px] font-black text-amber-200">
              Room {roomId}
            </div>
          </div>

          <div className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-center">
            <div className="text-[7px] font-black uppercase tracking-widest text-slate-500">
              Bet Range
            </div>

            <div className="text-[10px] font-black text-white">
              {formatCompactNumber(
                resolvedLimits.minBet
              )}
              {" – "}
              {formatCompactNumber(
                resolvedLimits.maxBet
              )}
            </div>
          </div>

        </div>

        {/* ERROR */}

        {error && (
          <div className="mb-2 rounded-xl border border-red-500/30 bg-red-950/40 px-3 py-2 text-xs font-semibold text-red-300">
            {error}
          </div>
        )}

        {/* SUCCESS */}

        {lastMessage && (
          <div className="mb-2 rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-3 py-2 text-xs font-semibold text-emerald-300">
            {lastMessage}
          </div>
        )}

        {/* ================================================== */}
        {/* DEALER / SHOE / TABLE */}
        {/* ================================================== */}

        <section className="mb-2 rounded-xl border border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950 p-2 shadow-2xl sm:p-3">

          {/* SHOE / LIMITS */}

          <div className="mb-3 rounded-2xl border border-amber-400/20 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 p-3 shadow-2xl sm:p-4">

            <div className="flex items-center justify-between gap-3">

              {/* SHOE */}

              <div className="flex min-w-0 items-center gap-3">

                <div className="relative hidden h-16 w-20 shrink-0 sm:block">

                  <div
                    className="absolute left-2 top-2 h-12 w-16 rounded-md border-2 border-amber-500/50 bg-slate-950 shadow-lg"
                    style={{
                      backgroundImage:
                        "url('/images/bg/deckbg.png')",
                      backgroundSize:
                        "cover",
                      backgroundPosition:
                        "center",
                    }}
                  />

                  <div
                    className="absolute left-1 top-1 h-12 w-16 rounded-md border-2 border-amber-500/60 bg-slate-950 shadow-lg"
                    style={{
                      backgroundImage:
                        "url('/images/bg/deckbg.png')",
                      backgroundSize:
                        "cover",
                      backgroundPosition:
                        "center",
                    }}
                  />

                  <div
                    className="absolute left-0 top-0 h-12 w-16 rounded-md border-2 border-amber-300/70 bg-slate-950 shadow-lg"
                    style={{
                      backgroundImage:
                        "url('/images/bg/deckbg.png')",
                      backgroundSize:
                        "cover",
                      backgroundPosition:
                        "center",
                    }}
                  />

                </div>

                <div className="min-w-0">

                  <div className="text-[8px] font-black uppercase tracking-[0.28em] text-amber-300/70">
                    MEME CASINO 8-Deck Shoe
                  </div>

                  <div className="mt-1 text-lg font-black tabular-nums text-white sm:text-xl">
                    {formatNumber(
                      shoe.cardsRemaining
                    )}

                    <span className="text-xs font-bold text-slate-500">
                      {" "}
                      /{" "}
                      {formatNumber(
                        shoe.totalCards
                      )}{" "}
                      cards
                    </span>
                  </div>

                  <div className="text-[8px] font-bold uppercase tracking-widest text-slate-500">
                    Shoe #
                    {shoe.shoeNumber}
                    {" · "}
                    room-specific dealer
                  </div>

                </div>

              </div>

              {/* BET LIMITS — SHOWN ONCE FOR THE WHOLE TABLE */}

              <div className="flex min-w-0 flex-1 items-center justify-center px-2 sm:px-4">
                <div className="w-full max-w-md rounded-xl border border-slate-800/80 bg-slate-950/60 px-3 py-2 text-center">
                  <div className="text-[8px] font-black uppercase tracking-[0.22em] text-amber-300 sm:text-[9px]">
                    {roomName} Bet Limits
                  </div>

                  <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <div>
                      <div className="text-[6px] font-black uppercase tracking-widest text-blue-400/80">
                        Player / Banker
                      </div>
                      <div className="mt-0.5 text-[9px] font-black tabular-nums text-white sm:text-[10px]">
                        {formatCompactNumber(resolvedLimits.playerMinBet)}
                        {" – "}
                        {formatCompactNumber(resolvedLimits.playerMaxBet)}
                      </div>
                    </div>

                    <div>
                      <div className="text-[6px] font-black uppercase tracking-widest text-emerald-400/80">
                        Tie
                      </div>
                      <div className="mt-0.5 text-[9px] font-black tabular-nums text-white sm:text-[10px]">
                        {formatCompactNumber(resolvedLimits.tieMinBet)}
                        {" – "}
                        {formatCompactNumber(resolvedLimits.tieMaxBet)}
                      </div>
                    </div>

                    <div className="col-span-2 sm:col-span-1">
                      <div className="text-[6px] font-black uppercase tracking-widest text-amber-400/80">
                        Room Exposure
                      </div>
                      <div className="mt-0.5 text-[9px] font-black tabular-nums text-emerald-300 sm:text-[10px]">
                        {formatNumber(resolvedLimits.maxExposure)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-1 text-[6px] font-bold uppercase tracking-wider text-slate-600 sm:text-[7px]">
                    Limits are shown once here · server enforced
                  </div>
                </div>
              </div>

              {/* SHOE PROGRESS */}

              <div className="flex shrink-0 flex-col items-end gap-2">

                <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-800 sm:w-40">

                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-500 via-yellow-300 to-amber-500 transition-all duration-500"
                    style={{
                      width: `${Math.max(
                        0,
                        Math.min(
                          100,
                          (shoe.cardsRemaining /
                            shoe.totalCards) *
                            100
                        )
                      )}%`,
                    }}
                  />

                </div>

                <div className="text-right text-[8px] font-black uppercase tracking-wider text-emerald-400">
                  Automatic reshuffle
                  <br />
                  below 150 cards
                </div>

              </div>

            </div>

          </div>

          {/* ================================================== */}
          {/* PLAYER / CENTER / BANKER */}
          {/* ================================================== */}

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_280px_1fr] lg:items-stretch">

            {/* PLAYER */}

            <div className="relative overflow-hidden rounded-2xl border border-blue-400/40 bg-gradient-to-br from-blue-950/40 via-slate-950 to-slate-950 p-3 shadow-2xl sm:p-5">

              <div className="relative z-10 mb-3 flex items-center justify-between gap-2">

                <div>
                  <div className="text-xs font-black tracking-[0.2em] text-blue-200 sm:text-sm">
                    PLAYER
                  </div>

                  <div className="mt-1 text-[8px] font-bold uppercase tracking-widest text-slate-300/80">
                    BETTING AREA
                  </div>
                </div>

                <div className="text-right">

                  <div className="text-lg font-black tabular-nums text-blue-200 sm:text-2xl">
                    {formatNumber(
                      globalTotals.player
                    )}
                  </div>

                  <div className="text-[8px] font-bold uppercase tracking-widest text-slate-300/70">
                    Total wagered
                  </div>

                  <div className="mt-1 text-[8px] font-black uppercase tracking-widest text-amber-300/80">
                    MY BET {formatNumber(myBetTotal.player)}
                  </div>

                </div>

              </div>

              <div className="relative z-10 mb-2 text-center">

                <div className="text-[8px] font-bold uppercase tracking-widest text-slate-300/70">
                  Hand total
                </div>

                <div className="text-3xl font-black text-white drop-shadow-lg sm:text-4xl">
                  {visiblePlayerTotal}
                </div>

              </div>

              <div className="relative z-10 flex min-h-[120px] flex-wrap items-center justify-center gap-2 sm:min-h-[150px] sm:gap-3">

                <PlayingCard
                  card={
                    visibleCards.player.card1
                  }
                  hidden={
                    !visibleCards.player
                      .card1
                  }
                  large
                />

                <PlayingCard
                  card={
                    visibleCards.player.card2
                  }
                  hidden={
                    !visibleCards.player
                      .card2
                  }
                  large
                />

                {visibleCards.player
                  .card3 && (
                  <PlayingCard
                    card={
                      visibleCards.player
                        .card3
                    }
                    large
                  />
                )}

              </div>

              {renderPanelBets(playerBets, "PLAYER")}

            </div>

            {/* CENTER */}

            <div className="relative flex flex-col rounded-2xl border border-amber-400/30 bg-gradient-to-b from-amber-950/20 via-slate-950 to-slate-950 p-3 shadow-2xl sm:p-4">

              <div className="mb-3 text-center">

                <div className="text-[7px] font-black uppercase tracking-[0.28em] text-amber-400/60">
                  Current Round
                </div>

                <div className="mt-1 truncate text-[11px] font-black tracking-tight text-white sm:text-xs">
                  {round
                    ? formatRoundCode(
                        round.roundId,
                        round.phaseStartedAt
                      )
                    : "BAC-CONNECTING-000000"}
                </div>

              </div>

              {/* PHASE */}

              <div className="mb-3 flex items-center justify-center gap-2">

                {round?.phase ===
                  "BETTING" && (
                  <div className="flex items-center gap-1.5 rounded-lg border border-amber-400/20 bg-amber-950/30 px-2 py-1">

                    <span className="text-[7px] font-black uppercase tracking-wider text-slate-500">
                      LEFT
                    </span>

                    <span className="font-mono text-sm font-black tabular-nums text-amber-300">
                      {
                        round.remainingSeconds
                      }
                      s
                    </span>

                  </div>
                )}

                {round?.phase ===
                  "DEALING" && (
                  <div className="flex items-center gap-1.5 rounded-lg border border-cyan-400/20 bg-cyan-950/30 px-2 py-1">

                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300" />

                    <span className="text-[8px] font-black uppercase tracking-wider text-cyan-300">
                      {dealingMessage}
                    </span>

                  </div>
                )}

                <div
                  className={[
                    "rounded-lg border px-2 py-1 text-[8px] font-black uppercase tracking-wider",

                    round?.phase ===
                      "BETTING"
                      ? "border-emerald-400/30 bg-emerald-950/40 text-emerald-300"
                      : "",

                    round?.phase ===
                      "DEALING"
                      ? "border-cyan-400/30 bg-cyan-950/40 text-cyan-300"
                      : "",

                    round?.phase ===
                      "RESULT"
                      ? "border-blue-400/30 bg-blue-950/40 text-blue-300"
                      : "",
                  ].join(" ")}
                >
                  {round?.phase ??
                    "CONNECTING"}
                </div>

              </div>

              {!publicKey && (
                <div className="mb-3 rounded-lg border border-amber-400/20 bg-amber-950/20 px-2 py-1.5 text-center text-[8px] font-bold text-amber-400">
                  Connect wallet to bet
                </div>
              )}

              {/* SELECTED BET */}

              <div className="mb-2 rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2">

                <div className="flex items-center justify-between gap-2">

                  <div>

                    <div className="text-[7px] font-black uppercase tracking-widest text-slate-500">
                      Selected Bet
                    </div>

                    <div className="text-base font-black text-amber-300">
                      {formatNumber(
                        selectedBet
                      )}
                    </div>

                  </div>

                  <div className="text-right">

                    <div className="text-[7px] font-black uppercase tracking-widest text-slate-500">
                      Vault
                    </div>

                    <div className="text-sm font-black text-emerald-300">
                      {formatNumber(
                        vaultBalance
                      )}
                    </div>

                  </div>

                </div>

              </div>

              {/* BET OPTIONS */}

              <div className="mb-3 grid grid-cols-3 gap-1">

                {betOptions.map(
                  (amount) => (
                    <button
                      key={amount}
                      type="button"
                      onClick={() =>
                        setSelectedBet(
                          amount
                        )
                      }
                      className={[
                        "rounded-lg border px-1 py-2 text-[9px] font-black transition",

                        selectedBet ===
                        amount
                          ? "border-amber-400 bg-amber-500 text-black shadow-lg shadow-amber-500/20"
                          : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500",
                      ].join(" ")}
                    >
                      {formatCompactNumber(
                        amount
                      )}
                    </button>
                  )
                )}

              </div>

              {/* BET BUTTONS */}

              <div className="grid grid-cols-3 gap-1.5">

                <BetButton
                  type="PLAYER"
                  label="PLAYER"
                />

                <BetButton
                  type="BANKER"
                  label="BANKER"
                />

                <BetButton
                  type="TIE"
                  label="TIE"
                />

              </div>

            </div>

            {/* BANKER */}

            <div className="relative overflow-hidden rounded-2xl border border-red-400/40 bg-gradient-to-br from-red-950/40 via-slate-950 to-slate-950 p-3 shadow-2xl sm:p-5">

              <div className="relative z-10 mb-3 flex items-center justify-between gap-2">

                <div>
                  <div className="text-xs font-black tracking-[0.2em] text-red-200 sm:text-sm">
                    BANKER
                  </div>

                  <div className="mt-1 text-[8px] font-bold uppercase tracking-widest text-slate-300/80">
                    BETTING AREA
                  </div>
                </div>

                <div className="text-right">

                  <div className="text-lg font-black tabular-nums text-red-200 sm:text-2xl">
                    {formatNumber(
                      globalTotals.banker
                    )}
                  </div>

                  <div className="text-[8px] font-bold uppercase tracking-widest text-slate-300/70">
                    Total wagered
                  </div>

                  <div className="mt-1 text-[8px] font-black uppercase tracking-widest text-amber-300/80">
                    MY BET {formatNumber(myBetTotal.banker)}
                  </div>

                </div>

              </div>

              <div className="relative z-10 mb-2 text-center">

                <div className="text-[8px] font-bold uppercase tracking-widest text-slate-300/70">
                  Hand total
                </div>

                <div className="text-3xl font-black text-white drop-shadow-lg sm:text-4xl">
                  {visibleBankerTotal}
                </div>

              </div>

              <div className="relative z-10 flex min-h-[120px] flex-wrap items-center justify-center gap-2 sm:min-h-[150px] sm:gap-3">

                <PlayingCard
                  card={
                    visibleCards.banker.card1
                  }
                  hidden={
                    !visibleCards.banker
                      .card1
                  }
                  large
                />

                <PlayingCard
                  card={
                    visibleCards.banker.card2
                  }
                  hidden={
                    !visibleCards.banker
                      .card2
                  }
                  large
                />

                {visibleCards.banker
                  .card3 && (
                  <PlayingCard
                    card={
                      visibleCards.banker
                        .card3
                    }
                    large
                  />
                )}

              </div>

              {renderPanelBets(bankerBets, "BANKER")}

            </div>

          </div>

          {/* TIE BETTING PANEL */}
          <div className="mt-3 rounded-2xl border border-emerald-400/40 bg-gradient-to-br from-emerald-950/40 via-slate-950 to-slate-950 p-3 shadow-2xl sm:p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-black tracking-[0.2em] text-emerald-200 sm:text-sm">
                  TIE
                </div>
                <div className="mt-1 text-[8px] font-bold uppercase tracking-widest text-slate-300/80">
                  BETTING AREA
                </div>
              </div>

              <div className="text-right">
                <div className="text-lg font-black tabular-nums text-emerald-200 sm:text-2xl">
                  {formatNumber(globalTotals.tie)}
                </div>
                  <div className="text-[8px] font-bold uppercase tracking-widest text-slate-300/70">
                    Total wagered
                  </div>

                  <div className="mt-1 text-[8px] font-black uppercase tracking-widest text-amber-300/80">
                    MY BET {formatNumber(myBetTotal.tie)}
                  </div>
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
              <div className="min-w-0">
                {renderPanelBets(tieBets, "TIE")}
              </div>

              <div className="sm:min-w-[150px]">
                <BetButton type="TIE" label="BET TIE" />
              </div>
            </div>
          </div>

          {/* RESULT */}

          {round?.phase ===
            "RESULT" && (
            <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/70 py-3 text-center">

              <div className="text-[8px] uppercase tracking-[0.3em] text-slate-500">
                Winner
              </div>

              <div
                className={[
                  "mt-1 text-2xl font-black sm:text-4xl",

                  round.result ===
                    "PLAYER"
                    ? "text-blue-400"
                    : "",

                  round.result ===
                    "BANKER"
                    ? "text-red-400"
                    : "",

                  round.result ===
                    "TIE"
                    ? "text-emerald-400"
                    : "",
                ].join(" ")}
              >
                {round.result}
              </div>

            </div>
          )}

        </section>

        {/* ================================================== */}
        {/* BIG ROAD */}
        {/* ================================================== */}

        <section className="mb-2 overflow-hidden rounded-xl border border-amber-400/15 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 shadow-2xl shadow-black/30">

          <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">

            <div>

              <div className="text-[10px] font-black uppercase tracking-[0.25em] text-amber-300">
                Big Road
              </div>

              <div className="mt-0.5 text-[7px] font-bold uppercase tracking-widest text-slate-500">
                {roomName} shoe history ·{" "}
                {roadHistory.length}{" "}
                hands
              </div>

            </div>

            <div className="flex items-center gap-3 text-[7px] font-black uppercase tracking-widest">

              <span className="text-blue-300">
                P Player
              </span>

              <span className="text-red-300">
                B Banker
              </span>

              <span className="text-emerald-300">
                T Tie
              </span>

            </div>

          </div>

          <div className="bg-slate-950/95 p-2 sm:p-3">

            <div className="overflow-x-auto pb-1">

              <div className="grid min-w-[1000px] grid-flow-col grid-rows-6 gap-1">

                {Array.from({
                  length: 50 * 6,
                }).map(
                  (_, index) => {
                    const c =
                      Math.floor(
                        index / 6
                      );

                    const r =
                      index % 6;

                    const cell =
                      bigRoad[c]?.[
                        r
                      ] ?? null;

                    return (
                      <div
                        key={`big-road-${c}-${r}`}
                        className="flex h-9 w-9 items-center justify-center rounded border border-slate-800/70 bg-slate-900/40 sm:h-10 sm:w-10"
                      >
                        {cell && (
                          <RoadDot
                            type={
                              cell.result
                            }
                            tie={
                              cell.ties >
                              0
                            }
                          />
                        )}
                      </div>
                    );
                  }
                )}

              </div>

            </div>

          </div>

        </section>

        {/* ================================================== */}
        {/* ROOM BETS */}
        {/* ================================================== */}

        <section className="rounded-2xl border border-slate-800 bg-slate-950 p-3 sm:p-4">

          <div className="mb-3 flex items-center justify-between">

            <div>

              <div className="text-xs font-black uppercase tracking-widest">
                {roomName} Bets
              </div>

              <div className="mt-1 text-[10px] text-slate-500">
                Individual bets for the current room round
              </div>

            </div>

            <div className="rounded-lg bg-slate-900 px-2 py-1 text-[9px] font-bold text-slate-400">
              {bets.length} bets
            </div>

          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-800">

            <div className="grid grid-cols-[1.3fr_.8fr_.8fr] bg-slate-900 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-slate-500">

              <div>
                Player
              </div>

              <div>
                Bet
              </div>

              <div className="text-right">
                Amount
              </div>

            </div>

            <div className="max-h-[280px] overflow-y-auto">

              {bets.length ===
              0 ? (
                <div className="px-3 py-8 text-center text-xs text-slate-600">
                  No bets yet.
                </div>
              ) : (
                bets.map(
                  (bet) => (
                    <div
                      key={
                        bet.id
                      }
                      className="grid grid-cols-[1.3fr_.8fr_.8fr] items-center border-t border-slate-800/70 px-3 py-3"
                    >

                      <div className="min-w-0">

                        <div className="truncate text-xs font-bold text-slate-300">
                          {shortWallet(
                            bet.wallet_address
                          )}
                        </div>

                        <div className="text-[8px] text-slate-600">
                          {new Date(
                            bet.created_at
                          ).toLocaleTimeString()}
                        </div>

                      </div>

                      <div>

                        <span
                          className={[
                            "rounded-lg px-2 py-1 text-[9px] font-black",

                            bet.bet_type ===
                              "PLAYER"
                              ? "bg-blue-500/15 text-blue-300"
                              : "",

                            bet.bet_type ===
                              "BANKER"
                              ? "bg-red-500/15 text-red-300"
                              : "",

                            bet.bet_type ===
                              "TIE"
                              ? "bg-emerald-500/15 text-emerald-300"
                              : "",
                          ].join(" ")}
                        >
                          {
                            bet.bet_type
                          }
                        </span>

                      </div>

                      <div className="text-right text-xs font-black text-white">
                        {formatNumber(
                          Number(
                            bet.amount
                          )
                        )}
                      </div>

                    </div>
                  )
                )
              )}

            </div>

          </div>

        </section>

      </div>
    </main>
  );
}