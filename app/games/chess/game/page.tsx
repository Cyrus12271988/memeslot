"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  ArrowLeft,
  Flag,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trophy,
} from "lucide-react";

// ============================================================
// TYPES
// ============================================================

type PieceColor = "w" | "b";
type PieceType = "p" | "n" | "b" | "r" | "q" | "k";

type ChessPiece = {
  color: PieceColor;
  type: PieceType;
};

type Board = (ChessPiece | null)[][];

type MoveRecord = {
  moveNumber: number;
  from: string;
  to: string;
  san: string;
  color: PieceColor;
  piece: string;
  captured: string | null;
  promotion: string | null;
  fen: string;
  createdAt: string;
};

type ActiveMatch = {
  id: string;
  table_id: number;

  player_1_wallet: string;
  player_2_wallet: string;

  player_1_color: string;
  player_2_color: string;

  status: string;
  current_turn: string | null;

  winner_wallet: string | null;
  result: string | null;

  table_amount: number;
  total_pot: number;
  payout: number;

  settled: boolean;

  started_at: string | null;
  finished_at: string | null;
  settled_at: string | null;

  board_fen: string;

  move_history: MoveRecord[];
  move_count: number;

  time_control_minutes?: number | null;

  // Optional in case your API includes check in the match response.
  check?: boolean;
};

type ApiResponse = {
  success: boolean;
  balance?: number;
  activeMatch?: ActiveMatch | null;
  error?: string;
};

type MoveResponse = {
  success: boolean;

  move?: MoveRecord;

  boardFen?: string;
  currentTurn?: string;

  check?: boolean;
  checkmate?: boolean;
  draw?: boolean;
  gameOver?: boolean;

  status?: string;

  winnerWallet?: string | null;
  result?: string | null;

  moveCount?: number;

  settlement?: {
    success?: boolean;
    settledAt?: string | null;
    error?: string;
    tableUpdateError?: string;
  } | null;

  settlementPending?: boolean;

  error?: string;
};

// ============================================================
// CONSTANTS
// ============================================================

const STARTING_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const FILES = [
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
];

const PIECES: Record<
  PieceColor,
  Record<PieceType, string>
> = {
  w: {
    k: "♔",
    q: "♕",
    r: "♖",
    b: "♗",
    n: "♘",
    p: "♙",
  },

  b: {
    k: "♚",
    q: "♛",
    r: "♜",
    b: "♝",
    n: "♞",
    p: "♟",
  },
};

const PIECE_NAMES: Record<PieceType, string> = {
  k: "King",
  q: "Queen",
  r: "Rook",
  b: "Bishop",
  n: "Knight",
  p: "Pawn",
};

// ============================================================
// HELPERS
// ============================================================

function formatAmount(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function normalizeColor(
  value: unknown
): PieceColor | null {
  if (typeof value !== "string") {
    return null;
  }

  const v = value.trim().toLowerCase();

  if (v === "w" || v === "white") {
    return "w";
  }

  if (v === "b" || v === "black") {
    return "b";
  }

  return null;
}

// ============================================================
// FEN PARSER
// ============================================================

function parseFen(fen: string): Board {
  const safeFen =
    fen?.trim() || STARTING_FEN;

  const position =
    safeFen.split(" ")[0];

  const rows =
    position.split("/");

  if (rows.length !== 8) {
    return parseFen(STARTING_FEN);
  }

  const board: Board = [];

  for (
    let rank = 0;
    rank < 8;
    rank++
  ) {
    const row: (
      | ChessPiece
      | null
    )[] = [];

    const fenRow = rows[rank];

    for (const character of fenRow) {
      if (/^[1-8]$/.test(character)) {
        for (
          let i = 0;
          i < Number(character);
          i++
        ) {
          row.push(null);
        }

        continue;
      }

      const lower =
        character.toLowerCase() as PieceType;

      if (
        [
          "p",
          "n",
          "b",
          "r",
          "q",
          "k",
        ].includes(lower)
      ) {
        row.push({
          color:
            character ===
            character.toUpperCase()
              ? "w"
              : "b",
          type: lower,
        });

        continue;
      }

      return parseFen(
        STARTING_FEN
      );
    }

    if (row.length !== 8) {
      return parseFen(
        STARTING_FEN
      );
    }

    board.push(row);
  }

  return board;
}

// ============================================================
// BOARD COORDINATES
// ============================================================

function squareToPosition(
  square: string
) {
  return {
    row:
      8 -
      Number(square[1]),

    col:
      square.charCodeAt(0) -
      97,
  };
}

function positionToSquare(
  row: number,
  col: number
) {
  return `${FILES[col]}${
    8 - row
  }`;
}

// ============================================================
// CLOCK
// ============================================================

function formatClock(ms: number) {
  const totalSeconds =
    Math.max(
      0,
      Math.ceil(ms / 1000)
    );

  const minutes =
    Math.floor(
      totalSeconds / 60
    );

  const seconds =
    totalSeconds % 60;

  return `${minutes}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function calculateClock(
  match: ActiveMatch,
  now: number
) {
  const limit =
    Number(
      match.time_control_minutes ??
        5
    ) * 60_000;

  const history =
    Array.isArray(
      match.move_history
    )
      ? match.move_history
      : [];

  let whiteUsed = 0;
  let blackUsed = 0;

  let turnStartedAt =
    match.started_at
      ? Date.parse(
          match.started_at
        )
      : now;

  for (const move of history) {
    const moveAt =
      Date.parse(
        move.createdAt
      );

    if (
      !Number.isFinite(
        moveAt
      ) ||
      !Number.isFinite(
        turnStartedAt
      )
    ) {
      continue;
    }

    const elapsed =
      Math.max(
        0,
        moveAt -
          turnStartedAt
      );

    if (
      move.color === "w"
    ) {
      whiteUsed +=
        elapsed;
    } else {
      blackUsed +=
        elapsed;
    }

    turnStartedAt =
      moveAt;
  }

  const currentTurn =
    normalizeColor(
      match.current_turn
    ) ?? "w";

  const currentElapsed =
    Math.max(
      0,
      now -
        turnStartedAt
    );

  if (
    currentTurn === "w"
  ) {
    whiteUsed +=
      currentElapsed;
  } else {
    blackUsed +=
      currentElapsed;
  }

  return {
    white: Math.max(
      0,
      limit - whiteUsed
    ),

    black: Math.max(
      0,
      limit - blackUsed
    ),
  };
}

// ============================================================
// WALLET DISPLAY
// ============================================================

function shortWallet(
  wallet: string
) {
  if (!wallet) {
    return "—";
  }

  return `${wallet.slice(
    0,
    4
  )}...${wallet.slice(-4)}`;
}

// ============================================================
// MAIN PAGE
// ============================================================

export default function ChessGamePage() {
  const router = useRouter();

  const searchParams =
    useSearchParams();

  const {
    publicKey,
    connected,
  } = useWallet();

  const walletAddress =
    publicKey?.toString() ?? "";

  const urlMatchId =
    searchParams.get(
      "matchId"
    ) ?? "";

  // ==========================================================
  // STATE
  // ==========================================================

  const [match, setMatch] =
    useState<ActiveMatch | null>(
      null
    );

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  const [moving, setMoving] =
    useState(false);

  const [resigning, setResigning] =
    useState(false);

  const [settling, setSettling] =
    useState(false);

  const [selectedSquare, setSelectedSquare] =
    useState<string | null>(
      null
    );

  const [promotionSquare, setPromotionSquare] =
    useState<string | null>(
      null
    );

  const [clockNow, setClockNow] =
    useState(Date.now());

  const [error, setError] =
    useState("");

  const [message, setMessage] =
    useState("");

  // ==========================================================
  // CHECK STATE
  // ==========================================================

  const [isInCheck, setIsInCheck] =
    useState(false);

  // ==========================================================
  // SOUND STATE
  // ==========================================================

  const audioContextRef =
    useRef<AudioContext | null>(
      null
    );

  // Prevent duplicate move sounds
  // when local state and polling both
  // observe the same move.
  const lastSoundMoveCountRef =
    useRef(0);

  // ==========================================================
  // CHESS SOUND ENGINE
  // ==========================================================

  const getAudioContext =
    useCallback(() => {
      if (
        typeof window ===
        "undefined"
      ) {
        return null;
      }

      const AudioContextClass =
        window.AudioContext ||
        (
          window as typeof window & {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;

      if (
        !AudioContextClass
      ) {
        return null;
      }

      if (
        !audioContextRef.current
      ) {
        audioContextRef.current =
          new AudioContextClass();
      }

      return audioContextRef.current;
    }, []);

  const playTone = useCallback(
    (
      frequency: number,
      duration: number,
      type:
        | OscillatorType
        | undefined = "sine",
      volume = 0.055,
      delay = 0
    ) => {
      const context =
        getAudioContext();

      if (!context) {
        return;
      }

      try {
        if (
          context.state ===
          "suspended"
        ) {
          void context.resume();
        }

        const oscillator =
          context.createOscillator();

        const gain =
          context.createGain();

        const start =
          context.currentTime +
          delay;

        oscillator.type =
          type;

        oscillator.frequency.setValueAtTime(
          frequency,
          start
        );

        gain.gain.setValueAtTime(
          0.0001,
          start
        );

        gain.gain.exponentialRampToValueAtTime(
          volume,
          start + 0.015
        );

        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          start + duration
        );

        oscillator.connect(
          gain
        );

        gain.connect(
          context.destination
        );

        oscillator.start(
          start
        );

        oscillator.stop(
          start + duration + 0.02
        );
      } catch (soundError) {
        console.error(
          "Chess sound error:",
          soundError
        );
      }
    },
    [getAudioContext]
  );

  const playChessSound =
    useCallback(
      (
        sound:
          | "move"
          | "capture"
          | "check"
          | "gameover"
          | "timeout"
          | "resign"
      ) => {
        switch (sound) {
          case "move":
            playTone(
              520,
              0.09,
              "sine",
              0.045
            );

            break;

          case "capture":
            playTone(
              180,
              0.12,
              "square",
              0.04
            );

            playTone(
              360,
              0.09,
              "sine",
              0.035,
              0.07
            );

            break;

          case "check":
            playTone(
              660,
              0.1,
              "square",
              0.05
            );

            playTone(
              880,
              0.16,
              "square",
              0.05,
              0.11
            );

            break;

          case "gameover":
            playTone(
              523,
              0.15,
              "sine",
              0.05
            );

            playTone(
              659,
              0.15,
              "sine",
              0.05,
              0.15
            );

            playTone(
              784,
              0.25,
              "sine",
              0.055,
              0.3
            );

            break;

          case "timeout":
            playTone(
              440,
              0.13,
              "square",
              0.05
            );

            playTone(
              330,
              0.13,
              "square",
              0.05,
              0.15
            );

            playTone(
              220,
              0.25,
              "square",
              0.05,
              0.3
            );

            break;

          case "resign":
            playTone(
              330,
              0.15,
              "sine",
              0.045
            );

            playTone(
              220,
              0.3,
              "sine",
              0.045,
              0.16
            );

            break;
        }
      },
      [playTone]
    );

  // ==========================================================
  // LOAD MATCH
  // ==========================================================

  const loadMatch = useCallback(
    async (
      silent = false
    ) => {
      if (!walletAddress) {
        setLoading(false);
        return;
      }

      try {
        if (silent) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        const query =
          new URLSearchParams({
            walletAddress,
          });

        if (urlMatchId) {
          query.set(
            "matchId",
            urlMatchId
          );
        }

        const response =
          await fetch(
            `/api/chess?${query.toString()}`,
            {
              method: "GET",
              cache: "no-store",
            }
          );

        const data: ApiResponse =
          await response.json();

        if (
          !response.ok ||
          !data.success
        ) {
          throw new Error(
            data.error ||
              "Unable to load Chess match."
          );
        }

        const active =
          data.activeMatch ??
          null;

        if (
          active &&
          urlMatchId &&
          String(active.id) !==
            String(urlMatchId)
        ) {
          throw new Error(
            "The requested Chess match does not belong to the returned match state."
          );
        }

        if (active) {
          const serverCheck =
            active.check;

          if (
            typeof serverCheck ===
            "boolean"
          ) {
            setIsInCheck(
              serverCheck
            );
          }
        }

        setMatch(active);

        if (!active) {
          setError(
            urlMatchId
              ? "Chess match was not found or you are not a player in it."
              : "No active Chess match was found."
          );
        } else {
          setError("");
        }
      } catch (err: any) {
        console.error(
          "Chess game load error:",
          err
        );

        setError(
          err?.message ||
            "Unable to load Chess match."
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [
      walletAddress,
      urlMatchId,
    ]
  );

  // ==========================================================
  // INITIAL LOAD
  // ==========================================================

  useEffect(() => {
    loadMatch();
  }, [loadMatch]);

  // ==========================================================
  // CLOCK TICK
  // ==========================================================

  useEffect(() => {
    const interval =
      setInterval(() => {
        setClockNow(
          Date.now()
        );
      }, 250);

    return () =>
      clearInterval(
        interval
      );
  }, []);

  // ==========================================================
  // AUTO REFRESH ACTIVE MATCH
  // ==========================================================

  useEffect(() => {
    if (
      !walletAddress ||
      !urlMatchId
    ) {
      return;
    }

    if (
      match &&
      match.status !==
        "PLAYING" &&
      match.settled
    ) {
      return;
    }

    const interval =
      setInterval(() => {
        loadMatch(true);
      }, 2000);

    return () =>
      clearInterval(
        interval
      );
  }, [
    walletAddress,
    urlMatchId,
    match?.status,
    match?.settled,
    loadMatch,
  ]);

  // ==========================================================
  // SERVER BOARD FEN
  // ==========================================================

  const boardFen =
    useMemo(() => {
      if (!match) {
        return STARTING_FEN;
      }

      const moveCount =
        Number(
          match.move_count ?? 0
        );

      const moveHistory =
        Array.isArray(
          match.move_history
        )
          ? match.move_history
          : [];

      if (
        moveCount === 0 &&
        moveHistory.length === 0
      ) {
        return STARTING_FEN;
      }

      return (
        match.board_fen?.trim() ||
        STARTING_FEN
      );
    }, [match]);

  // ==========================================================
  // PARSED BOARD
  // ==========================================================

  const board = useMemo(
    () => parseFen(boardFen),
    [boardFen]
  );

  // ==========================================================
  // PLAYER COLOR
  // ==========================================================

  const playerColor =
    useMemo<PieceColor | null>(
      () => {
        if (
          !match ||
          !walletAddress
        ) {
          return null;
        }

        if (
          match.player_1_wallet.toLowerCase() ===
          walletAddress.toLowerCase()
        ) {
          return normalizeColor(
            match.player_1_color
          );
        }

        if (
          match.player_2_wallet.toLowerCase() ===
          walletAddress.toLowerCase()
        ) {
          return normalizeColor(
            match.player_2_color
          );
        }

        return null;
      },
      [
        match,
        walletAddress,
      ]
    );

  // ==========================================================
  // TURN
  // ==========================================================

  const currentTurn =
    normalizeColor(
      match?.current_turn
    ) ?? "w";

  const isMyTurn =
    playerColor ===
      currentTurn &&
    match?.status ===
      "PLAYING";

  // ==========================================================
  // BOARD DISPLAY
  // ==========================================================

  const displayedSquares =
    useMemo(() => {
      const result: {
        square: string;
        row: number;
        col: number;
        displayRow: number;
        displayCol: number;
      }[] = [];

      const isBlackPerspective =
        playerColor === "b";

      for (
        let displayRow = 0;
        displayRow < 8;
        displayRow++
      ) {
        for (
          let displayCol = 0;
          displayCol < 8;
          displayCol++
        ) {
          const row =
            isBlackPerspective
              ? 7 -
                displayRow
              : displayRow;

          const col =
            isBlackPerspective
              ? 7 -
                displayCol
              : displayCol;

          result.push({
            square:
              positionToSquare(
                row,
                col
              ),

            row,
            col,

            displayRow,
            displayCol,
          });
        }
      }

      return result;
    }, [playerColor]);

  // ==========================================================
  // LAST MOVE
  // ==========================================================

  const lastMove =
    match?.move_history
      ?.length
      ? match.move_history[
          match.move_history.length -
            1
        ]
      : null;

  // ==========================================================
  // CLOCKS
  // ==========================================================

  const clocks = useMemo(
    () =>
      match
        ? calculateClock(
            match,
            clockNow
          )
        : {
            white: 0,
            black: 0,
          },
    [match, clockNow]
  );

  const clockExpired =
    match?.status ===
      "PLAYING" &&
    Math.min(
      clocks.white,
      clocks.black
    ) <= 0;

  // ==========================================================
  // TIMEOUT
  // ==========================================================

  useEffect(() => {
    if (
      !match ||
      match.status !==
        "PLAYING" ||
      !clockExpired
    ) {
      return;
    }

    const timeout =
      async () => {
        try {
          playChessSound(
            "timeout"
          );

          const response =
            await fetch(
              "/api/chess",
              {
                method: "POST",
                headers: {
                  "Content-Type":
                    "application/json",
                },

                body: JSON.stringify({
                  action:
                    "timeout",

                  matchId:
                    match.id,

                  walletAddress,
                }),
              }
            );

          const data =
            await response.json();

          if (
            !response.ok ||
            !data.success
          ) {
            await loadMatch(
              true
            );

            return;
          }

          setMatch(
            (previous) =>
              previous
                ? {
                    ...previous,

                    status:
                      data.status ??
                      "FINISHED",

                    winner_wallet:
                      data.winnerWallet ??
                      null,

                    result:
                      data.result ??
                      null,

                    settled:
                      data
                        .settlement
                        ?.success ===
                      true
                        ? true
                        : previous.settled,

                    settled_at:
                      data
                        .settlement
                        ?.settledAt ??
                      previous.settled_at,
                  }
                : previous
          );

          setMessage(
            "TIME — the Chess clock expired."
          );

          setIsInCheck(
            false
          );
        } catch (err) {
          console.error(
            "Chess timeout error:",
            err
          );
        }
      };

    timeout();
  }, [
    clockExpired,
    match?.id,
    match?.status,
    walletAddress,
    loadMatch,
    playChessSound,
  ]);

  // ==========================================================
  // LAST MOVE SQUARE
  // ==========================================================

  const isLastMoveSquare =
    (square: string) => {
      if (!lastMove) {
        return false;
      }

      return (
        lastMove.from ===
          square ||
        lastMove.to === square
      );
    };

  // ==========================================================
  // SUBMIT MOVE
  // ==========================================================

  const submitMove = async (
    from: string,
    to: string,
    promotion = "q"
  ) => {
    if (!match || moving) {
      return;
    }

    if (!walletAddress) {
      setError(
        "Connect your wallet first."
      );

      return;
    }

    if (!isMyTurn) {
      setError(
        "It is not your turn."
      );

      return;
    }

    try {
      setMoving(true);

      setError("");
      setMessage("");

      const response =
        await fetch(
          "/api/chess",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              action: "move",
              matchId: match.id,
              walletAddress,
              from,
              to,
              promotion,
            }),
          }
        );

      const data: MoveResponse =
        await response.json();

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.error ||
            "Illegal Chess move."
        );
      }

      // ======================================================
      // CHECK STATE
      // ======================================================

      setIsInCheck(
        data.check === true
      );

      // ======================================================
      // MOVE SOUND
      // ======================================================

      if (
        data.checkmate ||
        data.gameOver
      ) {
        playChessSound(
          "gameover"
        );
      } else if (
        data.check
      ) {
        playChessSound(
          "check"
        );
      } else if (
        data.move?.captured
      ) {
        playChessSound(
          "capture"
        );
      } else {
        playChessSound(
          "move"
        );
      }

      setMatch(
        (previous) => {
          if (!previous) {
            return previous;
          }

          return {
            ...previous,

            board_fen:
              data.boardFen ??
              previous.board_fen,

            current_turn:
              data.currentTurn ??
              previous.current_turn,

            status:
              data.status ??
              previous.status,

            winner_wallet:
              data.winnerWallet ??
              previous.winner_wallet,

            result:
              data.result ??
              previous.result,

            move_count:
              Number(
                data.moveCount ??
                  previous.move_count +
                    1
              ),

            move_history:
              data.move
                ? [
                    ...previous.move_history,
                    data.move,
                  ]
                : previous.move_history,

            settled:
              data
                .settlement
                ?.success ===
              true
                ? true
                : previous.settled,

            settled_at:
              data
                .settlement
                ?.settledAt ??
              previous.settled_at,
          };
        }
      );

      setSelectedSquare(
        null
      );

      setPromotionSquare(
        null
      );

      if (data.checkmate) {
        setMessage(
          "CHECKMATE — game finished."
        );
      } else if (data.draw) {
        setMessage(
          "DRAW — game finished."
        );
      } else if (data.check) {
        setMessage(
          "CHECK!"
        );
      } else {
        setMessage(
          "Move accepted."
        );
      }
    } catch (err: any) {
      console.error(
        "Chess move error:",
        err
      );

      setError(
        err?.message ||
          "Move could not be submitted."
      );

      await loadMatch(true);
    } finally {
      setMoving(false);
    }
  };

  // ==========================================================
  // SQUARE CLICK
  // ==========================================================

  const handleSquareClick =
    (square: string) => {
      if (
        !match ||
        match.status !==
          "PLAYING" ||
        moving
      ) {
        return;
      }

      if (!isMyTurn) {
        setError(
          "Wait for your opponent's move."
        );

        return;
      }

      const {
        row,
        col,
      } =
        squareToPosition(
          square
        );

      const piece =
        board[row]?.[col] ??
        null;

      // ======================================================
      // SELECT PIECE
      // ======================================================

      if (!selectedSquare) {
        if (
          piece?.color ===
          playerColor
        ) {
          setSelectedSquare(
            square
          );

          setError("");
        }

        return;
      }

      // ======================================================
      // DESELECT
      // ======================================================

      if (
        selectedSquare ===
        square
      ) {
        setSelectedSquare(
          null
        );

        setPromotionSquare(
          null
        );

        return;
      }

      // ======================================================
      // SELECT ANOTHER OWN PIECE
      // ======================================================

      if (
        piece?.color ===
        playerColor
      ) {
        setSelectedSquare(
          square
        );

        setPromotionSquare(
          null
        );

        return;
      }

      // ======================================================
      // FIND SELECTED PIECE
      // ======================================================

      const selectedPosition =
        squareToPosition(
          selectedSquare
        );

      const selected =
        board[
          selectedPosition.row
        ]?.[
          selectedPosition.col
        ];

      if (!selected) {
        setSelectedSquare(
          null
        );

        return;
      }

      // ======================================================
      // PROMOTION
      // ======================================================

      if (
        selected.type ===
        "p"
      ) {
        const destinationRank =
          Number(
            square[1]
          );

        if (
          (selected.color ===
            "w" &&
            destinationRank ===
              8) ||
          (selected.color ===
            "b" &&
            destinationRank ===
              1)
        ) {
          setPromotionSquare(
            square
          );

          return;
        }
      }

      // ======================================================
      // SUBMIT MOVE
      // ======================================================

      submitMove(
        selectedSquare,
        square,
        "q"
      );
    };

  // ==========================================================
  // PROMOTION
  // ==========================================================

  const choosePromotion =
    (
      piece:
        | "q"
        | "r"
        | "b"
        | "n"
    ) => {
      if (
        !selectedSquare ||
        !promotionSquare
      ) {
        return;
      }

      submitMove(
        selectedSquare,
        promotionSquare,
        piece
      );
    };

  // ==========================================================
  // RESIGN
  // ==========================================================

  const resign = async () => {
    if (
      !match ||
      resigning ||
      match.status !==
        "PLAYING"
    ) {
      return;
    }

    if (
      !window.confirm(
        "Are you sure you want to resign this Chess match?"
      )
    ) {
      return;
    }

    try {
      setResigning(true);

      setError("");
      setMessage("");

      const response =
        await fetch(
          "/api/chess",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              action: "resign",
              matchId: match.id,
              walletAddress,
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
          data.error ||
            "Unable to resign match."
        );
      }

      playChessSound(
        "resign"
      );

      setIsInCheck(
        false
      );

      setMatch(
        (previous) =>
          previous
            ? {
                ...previous,

                status:
                  data.status ??
                  "FINISHED",

                winner_wallet:
                  data.winnerWallet ??
                  null,

                result:
                  data.result ??
                  "RESIGNED",

                settled:
                  data
                    .settlement
                    ?.success ===
                  true
                    ? true
                    : previous.settled,

                settled_at:
                  data
                    .settlement
                    ?.settledAt ??
                  previous.settled_at,
              }
            : previous
      );

      setSelectedSquare(
        null
      );

      setPromotionSquare(
        null
      );

      setMessage(
        "You resigned the match."
      );
    } catch (err: any) {
      console.error(
        "Chess resign error:",
        err
      );

      setError(
        err?.message ||
          "Unable to resign match."
      );
    } finally {
      setResigning(false);
    }
  };

  // ==========================================================
  // RETRY SETTLEMENT
  // ==========================================================

  const retrySettlement =
    async () => {
      if (
        !match ||
        settling ||
        match.status ===
          "PLAYING"
      ) {
        return;
      }

      try {
        setSettling(true);

        setError("");
        setMessage("");

        const response =
          await fetch(
            "/api/chess",
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json",
              },

              body: JSON.stringify({
                action: "settle",
                matchId: match.id,
                walletAddress,
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
            data.error ||
              "Settlement is still pending."
          );
        }

        setMatch(
          (previous) =>
            previous
              ? {
                  ...previous,

                  settled:
                    data
                      .settlement
                      ?.success ===
                      true ||
                    previous.settled,

                  settled_at:
                    data
                      .settlement
                      ?.settledAt ??
                    previous.settled_at,
                }
              : previous
        );

        setMessage(
          "Settlement confirmed."
        );

        await loadMatch(
          true
        );
      } catch (err: any) {
        console.error(
          "Chess settlement retry error:",
          err
        );

        setError(
          err?.message ||
            "Settlement is still pending."
        );
      } finally {
        setSettling(false);
      }
    };

  // ==========================================================
  // RESULT
  // ==========================================================

  const resultText =
    useMemo(() => {
      if (
        !match ||
        match.status ===
          "PLAYING"
      ) {
        return "";
      }

      if (
        match.result ===
        "DRAW"
      ) {
        return "DRAW";
      }

      if (
        match.winner_wallet &&
        walletAddress &&
        match.winner_wallet.toLowerCase() ===
          walletAddress.toLowerCase()
      ) {
        return "YOU WIN";
      }

      if (
        match.winner_wallet
      ) {
        return "YOU LOSE";
      }

      return "MATCH FINISHED";
    }, [
      match,
      walletAddress,
    ]);

  // ==========================================================
  // LOADING
  // ==========================================================

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 text-white">
        <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4">
          <div className="flex items-center gap-3 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin text-amber-400" />

            <span className="font-semibold">
              Loading Chess match...
            </span>
          </div>
        </div>
      </main>
    );
  }

  // ==========================================================
  // NO MATCH
  // ==========================================================

  if (!match) {
    return (
      <main className="min-h-screen bg-slate-950 text-white">
        <div className="mx-auto max-w-3xl px-4 py-8">
          <button
            type="button"
            onClick={() =>
              router.push(
                "/games/chess"
              )
            }
            className="mb-5 flex items-center gap-2 text-sm font-bold text-emerald-300 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />

            Back to Chess lobby
          </button>

          <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-8 text-center">
            <h1 className="text-2xl font-black">
              Chess match unavailable
            </h1>

            <p className="mt-2 text-sm text-slate-500">
              {error ||
                "No match was found."}
            </p>
          </section>
        </div>
      </main>
    );
  }

  // ==========================================================
  // PLAYER COLORS
  // ==========================================================

  const whiteWallet =
    match.player_1_color
      .toLowerCase()
      .startsWith("w")
      ? match.player_1_wallet
      : match.player_2_wallet;

  const blackWallet =
    match.player_1_color
      .toLowerCase()
      .startsWith("b")
      ? match.player_1_wallet
      : match.player_2_wallet;

  const whiteActive =
    currentTurn === "w" &&
    match.status ===
      "PLAYING";

  const blackActive =
    currentTurn === "b" &&
    match.status ===
      "PLAYING";

  // ==========================================================
  // PLAYER PERSPECTIVE
  // ==========================================================

  const myColor =
    playerColor ?? "w";

  const opponentColor: PieceColor =
    myColor === "w"
      ? "b"
      : "w";

  const myWallet =
    myColor === "w"
      ? whiteWallet
      : blackWallet;

  const opponentWallet =
    opponentColor === "w"
      ? whiteWallet
      : blackWallet;

  const myClock =
    myColor === "w"
      ? clocks.white
      : clocks.black;

  const opponentClock =
    opponentColor === "w"
      ? clocks.white
      : clocks.black;

  const myActive =
    myColor === "w"
      ? whiteActive
      : blackActive;

  const opponentActive =
    opponentColor === "w"
      ? whiteActive
      : blackActive;

  const myColorLabel =
    myColor === "w"
      ? "WHITE"
      : "BLACK";

  const opponentColorLabel =
    opponentColor === "w"
      ? "WHITE"
      : "BLACK";

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-7xl px-2 py-2 sm:px-3 sm:py-3 lg:px-5">

        {/* ====================================================
            HEADER
        ==================================================== */}

        <header className="mb-2 rounded-xl border border-slate-800 bg-slate-900/80 p-2 shadow-xl backdrop-blur sm:p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">

            <button
              type="button"
              onClick={() =>
                router.push(
                  "/games/chess"
                )
              }
              className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-300 hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" />

              Chess Lobby
            </button>
{/* COPY CONTRACT ADDRESS */}
    <button
      onClick={() => {
        navigator.clipboard.writeText(
          "FhgGyS6mC4ZFd2KG5hJLGbiz7skgBaL7fkg2J79upump"
        );
      }}
      className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-950/80 hover:bg-slate-800/90 text-slate-300 hover:text-amber-400 text-xs font-bold rounded-xl border border-slate-700/60 shadow-md transition-all active:scale-95"
    >
      📋 Copy CA
    </button>
            <div className="text-center">
              <div className="text-[8px] font-bold uppercase tracking-[0.2em] text-slate-600">
                Chess Match
              </div>

              <div className="text-sm font-black text-amber-400">
                {formatAmount(
                  match.table_amount
                )}{" "}
                TABLE
              </div>
            </div>

            <button
              type="button"
              onClick={() =>
                loadMatch(true)
              }
              disabled={refreshing}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-950 hover:border-amber-400/40 disabled:opacity-50"
              title="Refresh match"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${
                  refreshing
                    ? "animate-spin"
                    : ""
                }`}
              />
            </button>
          </div>
        </header>

        {/* ====================================================
            ERROR
        ==================================================== */}

        {error ? (
          <div className="mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300">
            {error}
          </div>
        ) : null}

        {/* ====================================================
            MESSAGE
        ==================================================== */}

        {message ? (
          <div
            className={`mb-2 rounded-lg border px-3 py-2 text-xs font-semibold ${
              isInCheck
                ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
                : "border-emerald-400/20 bg-emerald-500/10 text-emerald-300"
            }`}
          >
            {message}
          </div>
        ) : null}

        {/* ====================================================
            CHECK BANNER
        ==================================================== */}

        {isInCheck &&
        match.status ===
          "PLAYING" ? (
          <div className="mb-2 flex items-center justify-center rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-center shadow-lg shadow-red-950/20">
            <span className="animate-pulse text-sm font-black tracking-[0.2em] text-red-400">
              CHECK
            </span>
          </div>
        ) : null}

        {/* ====================================================
            MAIN GRID
        ==================================================== */}

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">

          {/* ==================================================
              BOARD SECTION
          ================================================== */}

          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-2 shadow-2xl sm:p-3">

            {/* =================================================
                OPPONENT CLOCK

                IMPORTANT:
                TOP = ALWAYS OPPONENT
            ================================================= */}

            <div
              className={`mx-auto mb-2 flex w-full max-w-[min(68vh,680px)] items-center justify-between rounded-xl border px-3 py-2 ${
                opponentActive
                  ? "border-emerald-400/50 bg-emerald-400/10"
                  : "border-slate-800 bg-slate-950"
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.16em] ${
                      opponentColor ===
                      "w"
                        ? "bg-white text-slate-900"
                        : "bg-slate-800 text-white"
                    }`}
                  >
                    {
                      opponentColorLabel
                    }
                  </span>

                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[7px] font-black text-slate-500">
                    OPPONENT
                  </span>
                </div>

                <div className="mt-0.5 truncate text-[11px] font-bold text-slate-300">
                  {shortWallet(
                    opponentWallet
                  )}
                </div>
              </div>

              <div
                className={`shrink-0 rounded-lg px-3 py-1 font-mono text-xl font-black ${
                  opponentActive
                    ? "bg-emerald-400/10 text-emerald-300"
                    : "bg-slate-900 text-white"
                } ${
                  opponentClock <=
                  10_000
                    ? "!text-red-400"
                    : ""
                }`}
              >
                {formatClock(
                  opponentClock
                )}
              </div>
            </div>

            {/* =================================================
                CHESS BOARD
            ================================================= */}

            <div className="mx-auto w-full max-w-[min(68vh,680px)] overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl">
              <div className="grid grid-cols-8">

                {displayedSquares.map(
                  ({
                    square,
                    row,
                    col,
                    displayRow,
                    displayCol,
                  }) => {
                    const piece =
                      board[row]?.[
                        col
                      ] ?? null;

                    const dark =
                      (row + col) %
                        2 ===
                      1;

                    const selected =
                      selectedSquare ===
                      square;

                    const last =
                      isLastMoveSquare(
                        square
                      );

                    const rank =
                      8 - row;

                    const file =
                      FILES[col];

                    const showRank =
                      displayCol ===
                      0;

                    const showFile =
                      displayRow ===
                      7;

                    return (
                      <button
                        key={square}
                        type="button"
                        onClick={() =>
                          handleSquareClick(
                            square
                          )
                        }
                        aria-label={`${square}${
                          piece
                            ? ` ${PIECE_NAMES[piece.type]}`
                            : " empty"
                        }`}
                        className={`relative aspect-square select-none ${
                          dark
                            ? "bg-slate-700"
                            : "bg-slate-300"
                        } ${
                          selected
                            ? "ring-4 ring-inset ring-amber-400"
                            : ""
                        } ${
                          last
                            ? "shadow-[inset_0_0_0_999px_rgba(250,204,21,0.16)]"
                            : ""
                        }`}
                      >

                        {/* RANK */}

                        {showRank ? (
                          <span
                            className={`absolute left-1 top-1 text-[8px] font-black ${
                              dark
                                ? "text-slate-300"
                                : "text-slate-700"
                            }`}
                          >
                            {rank}
                          </span>
                        ) : null}

                        {/* FILE */}

                        {showFile ? (
                          <span
                            className={`absolute bottom-1 right-1 text-[8px] font-black ${
                              dark
                                ? "text-slate-300"
                                : "text-slate-700"
                            }`}
                          >
                            {file}
                          </span>
                        ) : null}

                        {/* PIECE */}

                        {piece ? (
                          <span
                            className={`relative z-10 flex h-full w-full items-center justify-center text-[clamp(1.7rem,6vw,4rem)] leading-none ${
                              piece.color ===
                              "w"
                                ? "text-white drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]"
                                : "text-slate-950 drop-shadow-[0_2px_2px_rgba(255,255,255,0.15)]"
                            }`}
                          >
                            {
                              PIECES[
                                piece
                                  .color
                              ][
                                piece
                                  .type
                              ]
                            }
                          </span>
                        ) : null}

                        {/* SELECTED INDICATOR */}

                        {selected ? (
                          <span className="absolute inset-0 z-0 m-auto h-3 w-3 rounded-full bg-amber-400/70 sm:h-4 sm:w-4" />
                        ) : null}

                      </button>
                    );
                  }
                )}

              </div>
            </div>

            {/* =================================================
                YOUR CLOCK

                IMPORTANT:
                BOTTOM = ALWAYS YOU
            ================================================= */}

            <div
              className={`mx-auto mt-2 flex w-full max-w-[min(68vh,680px)] items-center justify-between rounded-xl border px-3 py-2 ${
                myActive
                  ? "border-emerald-400/50 bg-emerald-400/10"
                  : "border-slate-800 bg-slate-950"
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.16em] ${
                      myColor === "w"
                        ? "bg-white text-slate-900"
                        : "bg-slate-800 text-white"
                    }`}
                  >
                    {
                      myColorLabel
                    }
                  </span>

                  <span className="rounded bg-emerald-400/10 px-1.5 py-0.5 text-[7px] font-black text-emerald-400">
                    YOUR CLOCK
                  </span>
                </div>

                <div className="mt-0.5 truncate text-[11px] font-bold text-slate-300">
                  {shortWallet(
                    myWallet
                  )}
                </div>
              </div>

              <div
                className={`shrink-0 rounded-lg px-3 py-1 font-mono text-xl font-black ${
                  myActive
                    ? "bg-emerald-400/10 text-emerald-300"
                    : "bg-slate-900 text-white"
                } ${
                  myClock <=
                  10_000
                    ? "!text-red-400"
                    : ""
                }`}
              >
                {formatClock(
                  myClock
                )}
              </div>
            </div>

            {/* =================================================
                BOARD STATUS
            ================================================= */}

            <div className="mx-auto mt-2 flex w-full max-w-[min(68vh,680px)] flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950 p-2">

              <div className="text-[11px] text-slate-400">
                {match.status ===
                "PLAYING" ? (
                  isMyTurn ? (
                    <span className="font-black text-emerald-400">
                      YOUR TURN
                    </span>
                  ) : (
                    <span>
                      OPPONENT'S TURN
                    </span>
                  )
                ) : (
                  <span className="font-black text-amber-400">
                    {resultText}
                  </span>
                )}
              </div>

              {/* RESIGN */}

              <button
                type="button"
                onClick={
                  resign
                }
                disabled={
                  !connected ||
                  !walletAddress ||
                  match.status !==
                    "PLAYING" ||
                  resigning ||
                  moving
                }
                className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[10px] font-black text-red-300 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {resigning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Flag className="h-3.5 w-3.5" />
                )}

                {resigning
                  ? "RESIGNING..."
                  : "RESIGN"}
              </button>
            </div>
          </section>

          {/* ====================================================
              SIDEBAR
          ==================================================== */}

          <aside className="space-y-3">

            {/* =================================================
                MATCH STATUS
            ================================================= */}

            <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">

              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />

                <h2 className="text-sm font-black">
                  MATCH STATUS
                </h2>
              </div>

              <div className="mt-3 space-y-1.5 text-xs">

                {/* TIME CONTROL */}

                <div className="flex justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950 p-2.5">
                  <span className="text-slate-500">
                    Time control
                  </span>

                  <span className="font-black text-amber-400">
                    {match.time_control_minutes ??
                      5}{" "}
                    MIN
                  </span>
                </div>

                {/* POT */}

                <div className="flex justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950 p-2.5">
                  <span className="text-slate-500">
                    Pot
                  </span>

                  <span className="font-black">
                    {formatAmount(
                      match.total_pot
                    )}
                  </span>
                </div>

                {/* MOVES */}

                <div className="flex justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950 p-2.5">
                  <span className="text-slate-500">
                    Moves
                  </span>

                  <span className="font-black">
                    {
                      match.move_count
                    }
                  </span>
                </div>

                {/* SETTLEMENT */}

                <div className="flex justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950 p-2.5">
                  <span className="text-slate-500">
                    Settlement
                  </span>

                  <span
                    className={
                      match.settled
                        ? "font-black text-emerald-400"
                        : "font-black text-amber-400"
                    }
                  >
                    {match.settled
                      ? "SETTLED"
                      : "PENDING"}
                  </span>
                </div>

              </div>
            </section>

            {/* =================================================
                RESULT
            ================================================= */}

            {match.status !==
            "PLAYING" ? (
              <section className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-center">

                <Trophy className="mx-auto h-8 w-8 text-amber-400" />

                <div className="mt-2 text-xl font-black text-amber-400">
                  {resultText}
                </div>

                <div className="mt-1 text-[10px] text-slate-500">
                  {match.result ??
                    "MATCH FINISHED"}
                </div>

                {!match.settled ? (
                  <button
                    type="button"
                    onClick={
                      retrySettlement
                    }
                    disabled={
                      settling
                    }
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-amber-400 px-3 py-2 text-[10px] font-black text-slate-950 hover:bg-amber-300 disabled:opacity-50"
                  >
                    {settling ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}

                    {settling
                      ? "SETTLING..."
                      : "RETRY SETTLEMENT"}
                  </button>
                ) : null}

              </section>
            ) : null}

            {/* =================================================
                MOVE HISTORY
            ================================================= */}

            <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-3">

              <div className="mb-2 flex items-center justify-between">

                <h2 className="text-sm font-black">
                  MOVE HISTORY
                </h2>

                <span className="text-[9px] font-bold text-slate-600">
                  {
                    match
                      .move_history
                      .length
                  }{" "}
                  MOVES
                </span>

              </div>

              <div className="max-h-[280px] space-y-1 overflow-y-auto pr-1">

                {match
                  .move_history
                  .length ===
                0 ? (
                  <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-center text-[10px] text-slate-600">
                    No moves yet.
                  </div>
                ) : (
                  match.move_history.map(
                    (
                      move
                    ) => (
                      <div
                        key={`${move.moveNumber}-${move.createdAt}`}
                        className="flex items-center justify-between rounded-lg bg-slate-950 px-2.5 py-1.5 text-[10px]"
                      >
                        <span className="w-7 font-bold text-slate-600">
                          {
                            move.moveNumber
                          }
                          .
                        </span>

                        <span className="flex-1 font-mono font-bold text-slate-300">
                          {
                            move.san
                          }
                        </span>

                        <span className="text-[8px] font-bold text-slate-600">
                          {move.color ===
                          "w"
                            ? "WHITE"
                            : "BLACK"}
                        </span>
                      </div>
                    )
                  )
                )}

              </div>
            </section>

            {/* =================================================
                SERVER AUTHORITATIVE
            ================================================= */}

            <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-3 text-[10px] text-slate-500">

              <div className="font-bold text-slate-300">
                SERVER AUTHORITATIVE
              </div>

              <p className="mt-1.5 leading-4">
                Legal moves, board
                state, turn order,
                clock expiry,
                resignation, and
                settlement are
                validated by the
                API/database. The
                board UI never decides
                whether a move is
                legal.
              </p>

            </section>
          </aside>
        </div>

        {/* ======================================================
            PROMOTION MODAL
        ====================================================== */}

        {promotionSquare ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">

            <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">

              <div className="text-center text-sm font-black">
                PROMOTE PAWN
              </div>

              <div className="mt-3 grid grid-cols-4 gap-2">

                {(
                  [
                    "q",
                    "r",
                    "b",
                    "n",
                  ] as const
                ).map(
                  (
                    piece
                  ) => (
                    <button
                      key={
                        piece
                      }
                      type="button"
                      onClick={() =>
                        choosePromotion(
                          piece
                        )
                      }
                      className="rounded-xl border border-slate-700 bg-slate-950 p-3 text-3xl hover:border-amber-400/50"
                    >
                      {
                        PIECES[
                          playerColor ??
                            "w"
                        ][
                          piece
                        ]
                      }
                    </button>
                  )
                )}

              </div>

              <button
                type="button"
                onClick={() => {
                  setPromotionSquare(
                    null
                  );

                  setSelectedSquare(
                    null
                  );
                }}
                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-[10px] font-bold text-slate-400 hover:text-white"
              >
                CANCEL
              </button>

            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}