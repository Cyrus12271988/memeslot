import { NextResponse } from "next/server";
import { Chess } from "chess.js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STARTING_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const TABLE_AMOUNTS = [
  10_000,
  25_000,
  50_000,
  100_000,
  500_000,
] as const;

const TIME_CONTROLS = [3, 5, 10] as const;

type Color = "w" | "b";

type MoveRecord = {
  moveNumber: number;
  from: string;
  to: string;
  san: string;
  color: Color;
  piece: string;
  captured: string | null;
  promotion: string | null;
  fen: string;
  createdAt: string;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function wallet(v: unknown) {
  return text(v).trim();
}

function sameWallet(a: unknown, b: unknown) {
  return wallet(a).toLowerCase() === wallet(b).toLowerCase();
}

function uuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function square(value: string) {
  return /^[a-h][1-8]$/.test(value);
}

function error(message: string, status = 400) {
  return NextResponse.json(
    {
      success: false,
      error: message,
    },
    { status }
  );
}

function historyOf(value: unknown): MoveRecord[] {
  return Array.isArray(value) ? (value as MoveRecord[]) : [];
}

function dbColor(color: Color) {
  return color === "w" ? "WHITE" : "BLACK";
}

function color(value: unknown): Color | null {
  const s = text(value).toLowerCase();

  if (s === "w" || s === "white") return "w";
  if (s === "b" || s === "black") return "b";

  return null;
}

/**
 * Rebuild the board from stored move history.
 *
 * The stored board_fen is useful for normal reads, but replaying
 * history gives us an independent verification of the game.
 */
function rebuildFromHistory(history: MoveRecord[]) {
  const chess = new Chess(STARTING_FEN);

  for (const item of history) {
    if (!square(item.from) || !square(item.to)) {
      throw new Error("Stored Chess history contains an invalid square.");
    }

    try {
      chess.move({
        from: item.from as any,
        to: item.to as any,
        ...(item.promotion
          ? { promotion: item.promotion as any }
          : {}),
      });
    } catch {
      throw new Error(
        `Stored Chess history is invalid at move ${item.moveNumber}.`
      );
    }
  }

  return chess;
}

function authoritativeChess(match: any) {
  const history = historyOf(match.move_history);

  if (
    Number(match.move_count ?? 0) === 0 &&
    history.length === 0
  ) {
    return new Chess(STARTING_FEN);
  }

  if (history.length > 0) {
    return rebuildFromHistory(history);
  }

  if (typeof match.board_fen === "string" && match.board_fen.trim()) {
    try {
      return new Chess(match.board_fen);
    } catch {
      throw new Error(
        "The stored Chess board is invalid and cannot be recovered."
      );
    }
  }

  throw new Error(
    "The Chess match has no recoverable board state."
  );
}

async function loadMatch(matchId: string) {
  return supabaseAdmin
    .from("chess_matches")
    .select(`
      id,
      table_id,
      player_1_wallet,
      player_2_wallet,
      player_1_color,
      player_2_color,
      status,
      current_turn,
      winner_wallet,
      result,
      table_amount,
      total_pot,
      payout,
      settled,
      started_at,
      finished_at,
      settled_at,
      board_fen,
      move_history,
      move_count
    `)
    .eq("id", matchId)
    .maybeSingle();
}

async function getTableTime(tableId: number) {
  const { data, error: dbError } = await supabaseAdmin
    .from("chess_tables")
    .select("time_control_minutes")
    .eq("id", tableId)
    .maybeSingle();

  if (dbError) throw dbError;

  const minutes = Number(data?.time_control_minutes);

  if (
    !TIME_CONTROLS.includes(
      minutes as (typeof TIME_CONTROLS)[number]
    )
  ) {
    return null;
  }

  return minutes;
}

function formatMatch(match: any, minutes: number | null) {
  const history = historyOf(match.move_history);
  const count = Number(match.move_count ?? 0);

  return {
    ...match,

    time_control_minutes: minutes,

    board_fen:
      count === 0 && history.length === 0
        ? STARTING_FEN
        : match.board_fen || STARTING_FEN,

    move_history: history,

    move_count: count,
  };
}

function playerColor(match: any, address: string): Color | null {
  if (sameWallet(match.player_1_wallet, address)) {
    return color(match.player_1_color);
  }

  if (sameWallet(match.player_2_wallet, address)) {
    return color(match.player_2_color);
  }

  return null;
}

/**
 * The clock for the side to move starts:
 *
 * - at match.started_at for move 1
 * - at the previous move's createdAt for later moves
 */
function turnStartedAt(match: any) {
  const history = historyOf(match.move_history);

  const last = history[history.length - 1];

  const value =
    last?.createdAt ??
    match.started_at;

  const timestamp = Date.parse(String(value));

  return Number.isFinite(timestamp)
    ? timestamp
    : null;
}

function remainingMs(
  match: any,
  minutes: number
) {
  const started = turnStartedAt(match);

  if (started === null) {
    return null;
  }

  return Math.max(
    0,
    minutes * 60_000 -
      (Date.now() - started)
  );
}

/* ============================================================
   GET
   ============================================================ */

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const address = wallet(
      searchParams.get("walletAddress")
    );

    const requestedMatchId = text(
      searchParams.get("matchId")
    );

    if (
      requestedMatchId &&
      !uuid(requestedMatchId)
    ) {
      return error("Invalid Chess match ID.");
    }

    /* --------------------------------------------------------
       Load all 15 queues
       -------------------------------------------------------- */

    const {
      data: tables,
      error: tablesError,
    } = await supabaseAdmin
      .from("chess_tables")
      .select(`
        id,
        table_amount,
        time_control_minutes,
        status,
        player_1_wallet,
        player_2_wallet,
        match_id,
        created_at,
        updated_at
      `)
      .in("table_amount", [
        ...TABLE_AMOUNTS,
      ])
      .in("time_control_minutes", [
        ...TIME_CONTROLS,
      ])
      .in("status", [
        "WAITING",
        "PLAYING",
      ])
      .order("time_control_minutes", {
        ascending: true,
      })
      .order("table_amount", {
        ascending: true,
      })
      .order("id", {
        ascending: true,
      });

    if (tablesError) {
      throw tablesError;
    }

    /* --------------------------------------------------------
       Balance
       -------------------------------------------------------- */

    let balance = 0;

    if (address) {
      const {
        data: user,
        error: userError,
      } = await supabaseAdmin
        .from("users")
        .select("vault_balance")
        .ilike("wallet_address", address)
        .maybeSingle();

      if (userError) {
        throw userError;
      }

      balance = Number(
        user?.vault_balance ?? 0
      );
    }

    /* --------------------------------------------------------
       Active/requested match
       -------------------------------------------------------- */

    let activeMatch: any = null;

    if (address) {
      let query = supabaseAdmin
        .from("chess_matches")
        .select(`
          id,
          table_id,
          player_1_wallet,
          player_2_wallet,
          player_1_color,
          player_2_color,
          status,
          current_turn,
          winner_wallet,
          result,
          table_amount,
          total_pot,
          payout,
          settled,
          started_at,
          finished_at,
          settled_at,
          board_fen,
          move_history,
          move_count
        `);

      if (requestedMatchId) {
        query = query
          .eq("id", requestedMatchId)
          .or(
            `player_1_wallet.ilike.${address},player_2_wallet.ilike.${address}`
          )
          .limit(1);
      } else {
        query = query
          .eq("status", "PLAYING")
          .or(
            `player_1_wallet.ilike.${address},player_2_wallet.ilike.${address}`
          )
          .order("started_at", {
            ascending: false,
          })
          .limit(1);
      }

      const {
        data: match,
        error: matchError,
      } = await query.maybeSingle();

      if (matchError) {
        throw matchError;
      }

      if (match) {
        activeMatch = formatMatch(
          match,
          await getTableTime(
            Number(match.table_id)
          )
        );
      }
    }

    /* --------------------------------------------------------
       Format queues
       -------------------------------------------------------- */

    const formattedTables = (
      tables ?? []
    ).map((table: any) => {
      const player1 =
        Boolean(table.player_1_wallet);

      const player2 =
        Boolean(table.player_2_wallet);

      return {
        id: Number(table.id),

        amount: Number(
          table.table_amount
        ),

        time_control_minutes:
          Number(
            table.time_control_minutes
          ),

        status: table.status,

        seats: {
          occupied:
            Number(player1) +
            Number(player2),

          total: 2,
        },

        player1,
        player2,

        full:
          player1 &&
          player2,

        matchId:
          table.match_id ?? null,

        createdAt:
          table.created_at,

        updatedAt:
          table.updated_at,
      };
    });

    return NextResponse.json({
      success: true,

      balance,

      tables: formattedTables,

      activeMatch,

      tableAmounts: [
        ...TABLE_AMOUNTS,
      ],

      timeControls: [
        ...TIME_CONTROLS,
      ],
    });
  } catch (e: any) {
    console.error(
      "Chess GET error:",
      e
    );

    return error(
      e?.message ||
        "Failed to load Chess data.",
      500
    );
  }
}

/* ============================================================
   POST
   ============================================================ */

export async function POST(
  request: Request
) {
  try {
    let body: any;

    try {
      body = await request.json();
    } catch {
      return error(
        "Invalid JSON request body."
      );
    }

    const action =
      text(body?.action).toLowerCase();

    const address =
      wallet(body?.walletAddress);

    if (!address) {
      return error(
        "Missing walletAddress."
      );
    }

    switch (action) {
      case "join":
        return join(
          body,
          address
        );

      case "move":
        return move(
          body,
          address
        );

      case "resign":
        return resign(
          body,
          address
        );

      case "timeout":
        return timeout(
          body,
          address
        );

      case "settle":
        return settle(
          body,
          address
        );

      default:
        return error(
          "Invalid Chess action. Use join, move, resign, timeout, or settle."
        );
    }
  } catch (e: any) {
    console.error(
      "Chess POST error:",
      e
    );

    return error(
      e?.message ||
        "Chess request failed.",
      500
    );
  }
}

/* ============================================================
   JOIN
   ============================================================ */

async function join(
  body: any,
  address: string
) {
  const tableId =
    Number(body?.tableId);

  const requestedMinutes =
    Number(
      body?.timeControlMinutes ?? 0
    );

  if (
    !Number.isInteger(tableId) ||
    tableId <= 0
  ) {
    return error(
      "Invalid Chess table."
    );
  }

  const {
    data,
    error: rpcError,
  } = await supabaseAdmin.rpc(
    "chess_join_table",
    {
      p_table_id: tableId,

      p_wallet_address:
        address,

      p_time_control_minutes:
        requestedMinutes || null,
    }
  );

  if (rpcError) {
    console.error(
      "chess_join_table:",
      rpcError
    );

    return error(
      rpcError.message ||
        "Unable to join Chess table."
    );
  }

  if (!data?.success) {
    return error(
      data?.error ||
        "Unable to join Chess table."
    );
  }

  return NextResponse.json({
    success: true,

    status:
      data.status,

    tableId:
      data.tableId,

    tableAmount:
      Number(data.tableAmount ?? 0),

    timeControlMinutes:
      Number(
        data.timeControlMinutes ?? 0
      ),

    matchId:
      data.matchId ?? null,

    seat:
      data.seat ?? null,

    vaultBalance:
      Number(
        data.vaultBalance ?? 0
      ),

    message:
      data.message ??
      "Chess table joined.",
  });
}

/* ============================================================
   MOVE
   ============================================================ */

async function move(
  body: any,
  address: string
) {
  const matchId =
    text(body?.matchId);

  const from =
    text(body?.from).toLowerCase();

  const to =
    text(body?.to).toLowerCase();

  const promotion =
    (
      text(body?.promotion) ||
      "q"
    ).toLowerCase();

  if (!uuid(matchId)) {
    return error(
      "Invalid Chess match."
    );
  }

  if (
    !square(from) ||
    !square(to)
  ) {
    return error(
      "Invalid Chess coordinates."
    );
  }

  if (
    !["q", "r", "b", "n"].includes(
      promotion
    )
  ) {
    return error(
      "Invalid promotion piece."
    );
  }

  const {
    data: match,
    error: matchError,
  } = await loadMatch(matchId);

  if (matchError) {
    throw matchError;
  }

  if (!match) {
    return error(
      "Chess match not found."
    );
  }

  if (
    match.status !== "PLAYING"
  ) {
    return error(
      "This Chess match is no longer active."
    );
  }

  const mine =
    playerColor(
      match,
      address
    );

  if (!mine) {
    return error(
      "You are not a player in this match.",
      403
    );
  }

  let chess: Chess;

  try {
    chess =
      authoritativeChess(match);
  } catch (e: any) {
    console.error(
      "Chess board recovery failed:",
      e
    );

    return error(
      e?.message ||
        "The Chess board could not be recovered.",
      500
    );
  }

  /* ----------------------------------------------------------
     CLOCK CHECK
     ---------------------------------------------------------- */

  const minutes =
    await getTableTime(
      Number(match.table_id)
    );

  if (minutes) {
    const left =
      remainingMs(
        match,
        minutes
      );

    if (
      left !== null &&
      left <= 0
    ) {
      return timeoutInternal(
        match,
        address,
        minutes
      );
    }
  }

  /* ----------------------------------------------------------
     TURN CHECK
     ---------------------------------------------------------- */

  if (
    chess.turn() !== mine
  ) {
    return error(
      "It is not your turn."
    );
  }

  const piece =
    chess.get(from as any);

  if (!piece) {
    return error(
      "There is no piece on that square."
    );
  }

  if (
    piece.color !== mine
  ) {
    return error(
      "You cannot move your opponent's piece."
    );
  }

  /*
   * IMPORTANT:
   *
   * This is the old FEN.
   *
   * Your previous route accidentally sent the NEW FEN
   * as p_expected_fen.
   */
  const expectedFen =
    chess.fen();

  let played: any;

  try {
    played =
      chess.move({
        from: from as any,
        to: to as any,
        promotion:
          promotion as any,
      });
  } catch {
    return error(
      "Illegal Chess move."
    );
  }

  if (!played) {
    return error(
      "Illegal Chess move."
    );
  }

  const newFen =
    chess.fen();

  const nextCount =
    Number(match.move_count ?? 0) +
    1;

  const createdAt =
    new Date().toISOString();

  const record: MoveRecord = {
    moveNumber:
      nextCount,

    from:
      played.from,

    to:
      played.to,

    san:
      played.san,

    color:
      played.color,

    piece:
      played.piece,

    captured:
      played.captured ?? null,

    promotion:
      played.promotion ?? null,

    fen:
      newFen,

    createdAt,
  };

  let status =
    "PLAYING";

  let winnerWallet:
    string | null = null;

  let result:
    string | null = null;

  /* ----------------------------------------------------------
     GAME OVER
     ---------------------------------------------------------- */

  if (chess.isCheckmate()) {
    status =
      "CHECKMATE";

    winnerWallet =
      mine === "w"
        ? match.player_1_wallet
        : match.player_2_wallet;

    result =
      mine === "w"
        ? "WHITE_CHECKMATE"
        : "BLACK_CHECKMATE";
  } else if (chess.isDraw()) {
    status =
      "DRAW";

    result =
      "DRAW";
  }

  const nextTurn =
    dbColor(
      chess.turn()
    );

  /* ----------------------------------------------------------
     ATOMIC DB COMMIT
     ---------------------------------------------------------- */

  const {
    data: applied,
    error: applyError,
  } = await supabaseAdmin.rpc(
    "chess_apply_move",
    {
      p_match_id:
        matchId,

      p_wallet_address:
        address,

      p_expected_fen:
        expectedFen,

      p_new_fen:
        newFen,

      p_next_turn:
        nextTurn,

      p_move_record:
        record,

      p_move_count:
        nextCount,

      p_status:
        status,

      p_winner_wallet:
        winnerWallet,

      p_result:
        result,
    }
  );

  if (applyError) {
    console.error(
      "chess_apply_move:",
      applyError
    );

    return error(
      applyError.message ||
        "Move could not be committed."
    );
  }

  if (!applied?.success) {
    return error(
      applied?.error ||
        "Move was rejected because the match changed. Refresh and try again."
    );
  }

  /* ----------------------------------------------------------
     SETTLE FINISHED GAME
     ---------------------------------------------------------- */

  let settlement:
    any = null;

  if (
    status !== "PLAYING"
  ) {
    settlement =
      await settleMatch(
        matchId,
        address
      );
  }

  return NextResponse.json({
    success: true,

    move:
      record,

    boardFen:
      newFen,

    currentTurn:
      nextTurn,

    check:
      chess.inCheck(),

    checkmate:
      chess.isCheckmate(),

    draw:
      chess.isDraw(),

    gameOver:
      chess.isGameOver(),

    status,

    winnerWallet,

    result,

    moveCount:
      nextCount,

    settlement,

    settlementPending:
      settlement
        ? settlement.success !== true
        : false,
  });
}

/* ============================================================
   RESIGN
   ============================================================ */

async function resign(
  body: any,
  address: string
) {
  const matchId =
    text(body?.matchId);

  if (!uuid(matchId)) {
    return error(
      "Invalid Chess match."
    );
  }

  const {
    data: match,
    error: matchError,
  } = await loadMatch(matchId);

  if (matchError) {
    throw matchError;
  }

  if (!match) {
    return error(
      "Chess match not found."
    );
  }

  if (
    match.status !== "PLAYING"
  ) {
    return error(
      "This match is already finished."
    );
  }

  let winnerWallet:
    string;

  let result:
    string;

  if (
    sameWallet(
      match.player_1_wallet,
      address
    )
  ) {
    winnerWallet =
      match.player_2_wallet;

    result =
      "PLAYER_1_RESIGNED";
  } else if (
    sameWallet(
      match.player_2_wallet,
      address
    )
  ) {
    winnerWallet =
      match.player_1_wallet;

    result =
      "PLAYER_2_RESIGNED";
  } else {
    return error(
      "You are not a player in this match.",
      403
    );
  }

  const {
    data: updated,
    error: updateError,
  } = await supabaseAdmin
    .from("chess_matches")
    .update({
      status:
        "RESIGNED",

      winner_wallet:
        winnerWallet,

      result,

      finished_at:
        new Date().toISOString(),
    })
    .eq("id", matchId)
    .eq("status", "PLAYING")
    .select("id")
    .maybeSingle();

  if (updateError) {
    throw updateError;
  }

  if (!updated) {
    return error(
      "The match was already finished. Refresh the board."
    );
  }

  const settlement =
    await settleMatch(
      matchId,
      address
    );

  return NextResponse.json({
    success: true,

    status:
      "RESIGNED",

    winnerWallet,

    result,

    settlement,

    settlementPending:
      settlement.success !== true,
  });
}

/* ============================================================
   TIMEOUT
   ============================================================ */

async function timeout(
  body: any,
  address: string
) {
  const matchId =
    text(body?.matchId);

  if (!uuid(matchId)) {
    return error(
      "Invalid Chess match."
    );
  }

  const {
    data: match,
    error: matchError,
  } = await loadMatch(matchId);

  if (matchError) {
    throw matchError;
  }

  if (!match) {
    return error(
      "Chess match not found."
    );
  }

  if (
    match.status !== "PLAYING"
  ) {
    return error(
      "This Chess match is no longer active."
    );
  }

  if (
    !playerColor(
      match,
      address
    )
  ) {
    return error(
      "You are not a player in this match.",
      403
    );
  }

  const minutes =
    await getTableTime(
      Number(match.table_id)
    );

  if (!minutes) {
    return error(
      "Chess time control is unavailable.",
      500
    );
  }

  const left =
    remainingMs(
      match,
      minutes
    );

  if (left === null) {
    return error(
      "Unable to determine the Chess clock."
    );
  }

  if (left > 0) {
    return error(
      "The Chess clock has not expired yet."
    );
  }

  return timeoutInternal(
    match,
    address,
    minutes
  );
}

/* ============================================================
   INTERNAL TIMEOUT
   ============================================================ */

async function timeoutInternal(
  match: any,
  address: string,
  minutes: number
) {
  if (
    match.status !== "PLAYING"
  ) {
    return error(
      "This Chess match is no longer active."
    );
  }

  if (
    !playerColor(
      match,
      address
    )
  ) {
    return error(
      "You are not a player in this match.",
      403
    );
  }

  const left =
    remainingMs(
      match,
      minutes
    );

  if (left === null) {
    return error(
      "Unable to determine the Chess clock."
    );
  }

  if (left > 0) {
    return error(
      "The Chess clock has not expired yet."
    );
  }

  let chess: Chess;

  try {
    chess =
      authoritativeChess(match);
  } catch (e: any) {
    return error(
      e?.message ||
        "The Chess board could not be recovered.",
      500
    );
  }

  const expired =
    chess.turn();

  const winnerWallet =
    expired === "w"
      ? match.player_2_wallet
      : match.player_1_wallet;

  const result =
    expired === "w"
      ? "WHITE_TIMEOUT"
      : "BLACK_TIMEOUT";

  const {
    data: updated,
    error: updateError,
  } = await supabaseAdmin
    .from("chess_matches")
    .update({
      status:
        "TIMEOUT",

      winner_wallet:
        winnerWallet,

      result,

      finished_at:
        new Date().toISOString(),
    })
    .eq("id", match.id)
    .eq("status", "PLAYING")
    .select("id")
    .maybeSingle();

  if (updateError) {
    throw updateError;
  }

  if (!updated) {
    return error(
      "The match changed while the clock expired. Refresh."
    );
  }

  const settlement =
    await settleMatch(
      match.id,
      address
    );

  return NextResponse.json({
    success: true,

    status:
      "TIMEOUT",

    winnerWallet,

    result,

    timeout: true,

    settlement,

    settlementPending:
      settlement.success !== true,
  });
}

/* ============================================================
   SETTLE
   ============================================================ */

async function settle(
  body: any,
  address: string
) {
  const matchId =
    text(body?.matchId);

  if (!uuid(matchId)) {
    return error(
      "Invalid Chess match."
    );
  }

  const {
    data: match,
    error: matchError,
  } = await loadMatch(matchId);

  if (matchError) {
    throw matchError;
  }

  if (!match) {
    return error(
      "Chess match not found."
    );
  }

  if (
    !sameWallet(
      match.player_1_wallet,
      address
    ) &&
    !sameWallet(
      match.player_2_wallet,
      address
    )
  ) {
    return error(
      "You are not a player in this match.",
      403
    );
  }

  if (
    match.status === "PLAYING"
  ) {
    return error(
      "This Chess match is still active."
    );
  }

  const settlement =
    await settleMatch(
      matchId,
      address
    );

  return NextResponse.json({
    success:
      settlement.success === true,

    status:
      match.status,

    winnerWallet:
      match.winner_wallet ?? null,

    result:
      match.result ?? null,

    settlement,

    error:
      settlement.success
        ? undefined
        : settlement.error,
  });
}

/* ============================================================
   SETTLEMENT HELPER
   ============================================================ */

async function settleMatch(
  matchId: string,
  address: string
) {
  try {
    const {
      data,
      error: rpcError,
    } = await supabaseAdmin.rpc(
      "chess_settle_match",
      {
        p_match_id:
          matchId,

        p_wallet_address:
          address,
      }
    );

    if (rpcError) {
      console.error(
        "chess_settle_match:",
        rpcError
      );

      return {
        success: false,
        error:
          rpcError.message ||
          "Settlement failed.",
      };
    }

    return (
      data ?? {
        success: false,
        error:
          "Settlement returned no result.",
      }
    );
  } catch (e: any) {
    console.error(
      "Chess settlement exception:",
      e
    );

    return {
      success: false,
      error:
        e?.message ||
        "Settlement failed.",
    };
  }
}