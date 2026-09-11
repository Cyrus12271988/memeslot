import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ============================================================
// SUPABASE
// ============================================================

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
  );
}

const supabase = createClient(
  supabaseUrl,
  serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// ============================================================
// CONFIG
// ============================================================

const BETTING_SECONDS = 60;
const CARD_REVEAL_MS = 1600;
const RESULT_HOLD_MS = 5000;

const SHOE_SIZE = 416;
const AUTO_SHUFFLE_THRESHOLD = 150;
const MIN_CARDS_REQUIRED = 6;

const ROAD_HISTORY_LIMIT = 120;

// ============================================================
// ROUND CONCURRENCY
// ============================================================
//
// Multiple clients poll the same room.
//
// Example:
//
// Browser A -> GET
// Browser B -> GET
// Browser C -> GET
//
// All three can arrive at nearly the same time.
//
// We serialize round creation/population PER ROOM inside this
// server process.
//
// The database unique active-round index remains the final
// protection.
//
// ============================================================

const roomRoundLocks = new Map<
  number,
  Promise<void>
>();

async function withRoomRoundLock<T>(
  roomId: number,
  fn: () => Promise<T>
): Promise<T> {
  const previous =
    roomRoundLocks.get(roomId);

  let release!: () => void;

  const current =
    new Promise<void>((resolve) => {
      release = resolve;
    });

  roomRoundLocks.set(
    roomId,
    current
  );

  if (previous) {
    await previous.catch(() => {});
  }

  try {
    return await fn();
  } finally {
    release();

    if (
      roomRoundLocks.get(roomId) ===
      current
    ) {
      roomRoundLocks.delete(
        roomId
      );
    }
  }
}

// ============================================================
// TYPES
// ============================================================

const BET_TYPES = [
  "PLAYER",
  "BANKER",
  "TIE",
] as const;

type BetType =
  (typeof BET_TYPES)[number];

type BaccaratPhase =
  | "BETTING"
  | "DEALING"
  | "RESULT";

type Card = {
  rank: string;
  suit: string;
  value: number;
  display: string;
};

type RoomLimits = {
  id: number;
  roomName: string;
  minBet: number;
  maxBet: number;
  maxExposure: number;
  tieMinBet: number;
  tieMaxBet: number;
  level: string;
  active: boolean;
};

// ============================================================
// CARD DEFINITIONS
// ============================================================

const RANKS = [
  { rank: "A", value: 1 },
  { rank: "2", value: 2 },
  { rank: "3", value: 3 },
  { rank: "4", value: 4 },
  { rank: "5", value: 5 },
  { rank: "6", value: 6 },
  { rank: "7", value: 7 },
  { rank: "8", value: 8 },
  { rank: "9", value: 9 },
  { rank: "10", value: 0 },
  { rank: "J", value: 0 },
  { rank: "Q", value: 0 },
  { rank: "K", value: 0 },
];

const SUITS = [
  { symbol: "♠" },
  { symbol: "♥" },
  { symbol: "♦" },
  { symbol: "♣" },
];

// ============================================================
// DECK
// ============================================================

function createDeck(): Card[] {
  return RANKS.flatMap((rank) =>
    SUITS.map((suit) => ({
      rank: rank.rank,
      suit: suit.symbol,
      value: rank.value,
      display: `${rank.rank}${suit.symbol}`,
    }))
  );
}

function shuffleDeck(
  deck: Card[]
): Card[] {
  const result = [...deck];

  for (
    let i = result.length - 1;
    i > 0;
    i--
  ) {
    const j =
      crypto.randomInt(
        0,
        i + 1
      );

    [
      result[i],
      result[j],
    ] = [
      result[j],
      result[i],
    ];
  }

  return result;
}

function createEightDeckShoe(): Card[] {
  const cards = Array.from(
    {
      length: 8,
    },
    () => createDeck()
  ).flat();

  return shuffleDeck(cards);
}

// ============================================================
// BACCARAT RULES
// ============================================================

function baccaratTotal(
  cards: Card[]
): number {
  return (
    cards.reduce(
      (sum, card) =>
        sum + card.value,
      0
    ) % 10
  );
}

function playerDraws(
  total: number
): boolean {
  return total <= 5;
}

function bankerDrawsWithoutPlayerThird(
  total: number
): boolean {
  return total <= 5;
}

function bankerDrawsWithPlayerThird(
  bankerTotal: number,
  playerThirdValue: number
): boolean {
  if (bankerTotal <= 2) {
    return true;
  }

  if (bankerTotal === 3) {
    return playerThirdValue !== 8;
  }

  if (bankerTotal === 4) {
    return ![
      0,
      1,
      8,
      9,
    ].includes(
      playerThirdValue
    );
  }

  if (bankerTotal === 5) {
    return ![
      0,
      1,
      2,
      3,
      8,
      9,
    ].includes(
      playerThirdValue
    );
  }

  if (bankerTotal === 6) {
    return [
      6,
      7,
    ].includes(
      playerThirdValue
    );
  }

  return false;
}

// ============================================================
// ROUND ID
// ============================================================

function createRoundId(): string {
  const now =
    new Date();

  const stamp =
    now
      .toISOString()
      .replace(
        /[-:TZ.]/g,
        ""
      )
      .slice(
        0,
        14
      );

  return `BAC-${stamp}-${crypto
    .randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;
}

// ============================================================
// ROOM HELPERS
// ============================================================

function parseRoomId(
  value: unknown
): number {
  const roomId =
    Number(value);

  if (
    !Number.isInteger(
      roomId
    ) ||
    roomId <= 0 ||
    roomId > 32767
  ) {
    throw new Error(
      "A valid Baccarat roomId is required."
    );
  }

  return roomId;
}

// ============================================================
// GET ROOM
// ============================================================

async function getRoom(
  roomId: number
): Promise<RoomLimits> {
  const {
    data,
    error,
  } =
    await supabase.rpc(
      "baccarat_get_room",
      {
        p_room_id:
          roomId,
      }
    );

  if (error) {
    throw new Error(
      `Failed to load Baccarat room: ${error.message}`
    );
  }

  if (!data) {
    throw new Error(
      `Baccarat room ${roomId} was not found.`
    );
  }

  const room =
    typeof data ===
    "string"
      ? JSON.parse(data)
      : data;

  return {
    id: Number(
      room.id
    ),

    roomName: String(
      room.roomName ??
        room.room_name ??
        `Room ${roomId}`
    ),

    minBet: Number(
      room.minBet ??
        room.min_bet ??
        0
    ),

    maxBet: Number(
      room.maxBet ??
        room.max_bet ??
        0
    ),

    maxExposure: Number(
      room.maxExposure ??
        room.max_exposure ??
        0
    ),

    tieMinBet: Number(
      room.tieMinBet ??
        room.tie_min_bet ??
        0
    ),

    tieMaxBet: Number(
      room.tieMaxBet ??
        room.tie_max_bet ??
        0
    ),

    level: String(
      room.level ??
        "STANDARD"
    ),

    active:
      Boolean(
        room.active
      ),
  };
}

// ============================================================
// ROOM LIST
// ============================================================

async function getRooms(): Promise<
  RoomLimits[]
> {
  const {
    data,
    error,
  } =
    await supabase.rpc(
      "baccarat_list_rooms"
    );

  if (error) {
    throw new Error(
      `Failed to load Baccarat rooms: ${error.message}`
    );
  }

  if (!data) {
    return [];
  }

  const rows =
    typeof data ===
    "string"
      ? JSON.parse(data)
      : data;

  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map(
    (
      room: any
    ): RoomLimits => ({
      id: Number(
        room.id
      ),

      roomName: String(
        room.roomName ??
          room.room_name ??
          `Room ${room.id}`
      ),

      minBet: Number(
        room.minBet ??
          room.min_bet ??
          0
      ),

      maxBet: Number(
        room.maxBet ??
          room.max_bet ??
          0
      ),

      maxExposure: Number(
        room.maxExposure ??
          room.max_exposure ??
          0
      ),

      tieMinBet: Number(
        room.tieMinBet ??
          room.tie_min_bet ??
          0
      ),

      tieMaxBet: Number(
        room.tieMaxBet ??
          room.tie_max_bet ??
          0
      ),

      level: String(
        room.level ??
          "STANDARD"
      ),

      active:
        Boolean(
          room.active
        ),
    })
  );
}

// ============================================================
// LIMIT RESPONSE
// ============================================================

function getLimitsResponse(
  room: RoomLimits
) {
  return {
    roomId:
      room.id,

    minBet:
      room.minBet,

    maxBet:
      room.maxBet,

    playerMinBet:
      room.minBet,

    playerMaxBet:
      room.maxBet,

    bankerMinBet:
      room.minBet,

    bankerMaxBet:
      room.maxBet,

    tieMinBet:
      room.tieMinBet,

    tieMaxBet:
      room.tieMaxBet,

    maxExposure:
      room.maxExposure,
  };
}

// ============================================================
// ROOM RESPONSE
// ============================================================
//
// The room identity and its limits are always built from the
// same RoomLimits object. This prevents the UI from accidentally
// displaying limits from a previously selected room.
// ============================================================

function getRoomResponse(room: RoomLimits) {
  return {
    id: room.id,
    roomId: room.id,
    roomName: room.roomName,
    level: room.level,
    active: room.active,

    minBet: room.minBet,
    maxBet: room.maxBet,
    tieMinBet: room.tieMinBet,
    tieMaxBet: room.tieMaxBet,
    maxExposure: room.maxExposure,

    limits: getLimitsResponse(room),
  };
}

// ============================================================
// STORED SHOE
// ============================================================

async function getStoredShoeState(
  roomId: number
): Promise<
  {
    shoeNumber: number;
    position: number;
    cardsRemaining: number;
  } | null
> {
  const {
    data,
    error,
  } =
    await supabase
      .from(
        "baccarat_room_shoes"
      )
      .select(
        "room_id, position, shoe_number, cards"
      )
      .eq(
        "room_id",
        roomId
      )
      .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to load Baccarat shoe: ${error.message}`
    );
  }

  if (!data) {
    return null;
  }

  const position =
    Number(
      data.position
    ) || 0;

  const shoeNumber =
    Number(
      data.shoe_number
    ) || 1;

  return {
    shoeNumber,

    position,

    cardsRemaining:
      Math.max(
        0,
        SHOE_SIZE -
          position
      ),
  };
}

// ============================================================
// ROOM SHUFFLE
// ============================================================

async function shuffleGlobalShoe(
  roomId: number
): Promise<{
  shoeNumber: number;
  position: number;
  cardsRemaining: number;
}> {
  const cards =
    createEightDeckShoe();

  const {
    data,
    error,
  } =
    await supabase.rpc(
      "baccarat_shuffle_room",
      {
        p_room_id: roomId,
        p_cards: cards,
      }
    );

  if (error) {
    throw new Error(
      `Failed to shuffle Baccarat shoe: ${error.message}`
    );
  }

  return {
    shoeNumber:
      Number(
        data?.shoeNumber ??
          data?.shoe_number
      ) || 1,

    position: 0,

    cardsRemaining:
      SHOE_SIZE,
  };
}

// ============================================================
// ENSURE SHOE FOR DRAW
// ============================================================

async function ensureShoeForDraw(
  roomId: number,
  requiredCards: number
): Promise<{
  shoeNumber: number;
  position: number;
  cardsRemaining: number;
}> {
  let shoe =
    await getStoredShoeState(roomId);

  if (!shoe) {
    return await shuffleGlobalShoe(roomId);
  }

  if (
    shoe.cardsRemaining <
    requiredCards
  ) {
    return await shuffleGlobalShoe(roomId);
  }

  // Do not reshuffle here merely because the shoe is below the
  // automatic threshold. A round may legitimately consume cards
  // while the shoe is below that threshold. Reshuffling here could
  // change the shoe in the middle of a round.
  //
  // The threshold is enforced only when a NEW round starts.
  return shoe;
}

// ============================================================
// ENSURE SHOE
// ============================================================

async function ensureShoe(
  roomId: number
): Promise<{
  shoeNumber: number;
  position: number;
  cardsRemaining: number;
}> {
  const shoe =
    await getStoredShoeState(roomId);

  if (!shoe) {
    return await shuffleGlobalShoe(roomId);
  }

  // Read-only after a shoe exists. Automatic reshuffling is
  // handled at the start of a NEW round, never by polling.
  return shoe;
}

// ============================================================
// ENSURE SHOE FOR NEW ROUND
// ============================================================

async function ensureShoeForNewRound(
  roomId: number
): Promise<{
  shoeNumber: number;
  position: number;
  cardsRemaining: number;
}> {
  const shoe = await getStoredShoeState(roomId);

  if (!shoe) {
    return await shuffleGlobalShoe(roomId);
  }

  if (shoe.cardsRemaining < AUTO_SHUFFLE_THRESHOLD) {
    return await shuffleGlobalShoe(roomId);
  }

  return shoe;
}

// ============================================================
// DRAW CARDS
// ============================================================

async function drawCards(
  roomId: number,
  count: number
): Promise<{
  cards: Card[];
  shoeNumber: number;
  position: number;
  cardsRemaining: number;
}> {
  if (
    !Number.isInteger(
      count
    ) ||
    count <= 0
  ) {
    throw new Error(
      "Invalid Baccarat card draw count."
    );
  }

  await ensureShoeForDraw(
    roomId,
    count
  );

  let {
    data,
    error,
  } =
    await supabase.rpc(
      "baccarat_draw_room_cards",
      {
        p_room_id: roomId,
        p_count: count,
      }
    );

  if (error) {
    const message =
      String(
        error.message ||
          ""
      ).toLowerCase();

    const shouldRetry =
      message.includes(
        "not enough"
      ) ||
      message.includes(
        "remaining"
      ) ||
      message.includes(
        "shoe"
      ) ||
      message.includes(
        "insufficient"
      );

    if (!shouldRetry) {
      throw new Error(
        `Failed to draw Baccarat cards: ${error.message}`
      );
    }

    await shuffleGlobalShoe(roomId);

    const retry =
      await supabase.rpc(
        "baccarat_draw_room_cards",
        {
          p_room_id: roomId,
          p_count: count,
        }
      );

    data =
      retry.data;

    error =
      retry.error;

    if (error) {
      throw new Error(
        `Failed to draw Baccarat cards after reshuffle: ${error.message}`
      );
    }
  }

  const cards =
    Array.isArray(
      data?.cards
    )
      ? (data.cards as Card[])
      : [];

  if (
    cards.length !==
    count
  ) {
    throw new Error(
      `Baccarat draw returned ${cards.length} cards, expected ${count}.`
    );
  }

  const position =
    Number(
      data?.position
    ) || 0;

  const shoeNumber =
    Number(
      data?.shoeNumber ??
        data?.shoe_number
    ) || 1;

  return {
    cards,

    shoeNumber,

    position,

    cardsRemaining:
      Math.max(
        0,
        SHOE_SIZE -
          position
      ),
  };
}

// ============================================================
// ACTIVE ROUND
// ============================================================

async function getActiveRound(
  roomId: number
): Promise<any | null> {
  const {
    data,
    error,
  } =
    await supabase
      .from(
        "baccarat_rounds"
      )
      .select("*")
      .eq(
        "room_id",
        roomId
      )
      .in(
        "status",
        [
          "BETTING",
          "DEALING",
        ]
      )
      .order(
        "created_at",
        {
          ascending:
            false,
        }
      )
      .limit(1)
      .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to load active Baccarat round: ${error.message}`
    );
  }

  return data;
}

// ============================================================
// LATEST ROUND
// ============================================================

async function getLatestRound(
  roomId: number
): Promise<any | null> {
  const {
    data,
    error,
  } =
    await supabase
      .from(
        "baccarat_rounds"
      )
      .select("*")
      .eq(
        "room_id",
        roomId
      )
      .order(
        "created_at",
        {
          ascending:
            false,
        }
      )
      .limit(1)
      .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to load Baccarat round: ${error.message}`
    );
  }

  return data;
}

// ============================================================
// ROUND COMPLETENESS
// ============================================================

function isRoundPopulated(
  round: any
): boolean {
  return Boolean(
    round?.player_card_1 &&
      round?.player_card_2 &&
      round?.banker_card_1 &&
      round?.banker_card_2
  );
}

// ============================================================
// UNIQUE ACTIVE ROUND ERROR
// ============================================================

function isActiveRoundConflict(
  error: any
): boolean {
  if (!error) {
    return false;
  }

  const code =
    String(
      error.code ??
        ""
    );

  const message =
    String(
      error.message ??
        ""
    ).toLowerCase();

  return (
    code ===
      "23505" &&
    (
      message.includes(
        "baccarat_one_active_round_idx"
      ) ||
      message.includes(
        "one_active_round"
      ) ||
      message.includes(
        "duplicate key"
      )
    )
  );
}

// ============================================================
// WAIT FOR ACTIVE ROUND
// ============================================================

async function waitForActiveRound(
  roomId: number,
  maxWaitMs = 2500
): Promise<any | null> {
  const started =
    Date.now();

  let delay = 100;

  while (
    Date.now() -
      started <
    maxWaitMs
  ) {
    const active =
      await getActiveRound(
        roomId
      );

    if (active) {
      return active;
    }

    await new Promise<void>(
      (resolve) =>
        setTimeout(
          resolve,
          delay
        )
    );

    delay =
      Math.min(
        delay + 50,
        300
      );
  }

  return null;
}

// ============================================================
// POPULATE NEW ROUND
// ============================================================
//
// IMPORTANT:
//
// The round row is inserted FIRST.
//
// Only after the row exists do we consume cards.
//
// This prevents two requests from both deciding that they own
// the same new round.
//
// ============================================================

async function populateNewRound(
  round: any
): Promise<any> {
  const roomId =
    Number(
      round.room_id
    );

  const roundId =
    String(
      round.round_id
    );

  if (
    isRoundPopulated(
      round
    )
  ) {
    return round;
  }

  // ----------------------------------------------------------
  // Prepare the shoe for this NEW round.
  //
  // The automatic threshold is checked here only. Once the round
  // starts, subsequent card draws never reshuffle just because the
  // shoe crosses the threshold.
  // ----------------------------------------------------------

  const startingShoe =
    await ensureShoeForNewRound(roomId);

  const commitmentStartPosition =
    startingShoe.position;

  const initial =
    await drawCards(roomId, 4);

  const playerCards: Card[] =
    [
      initial.cards[0],
      initial.cards[2],
    ];

  const bankerCards: Card[] =
    [
      initial.cards[1],
      initial.cards[3],
    ];

  let playerThird:
    | Card
    | null = null;

  let bankerThird:
    | Card
    | null = null;

  const playerInitial =
    baccaratTotal(
      playerCards
    );

  const bankerInitial =
    baccaratTotal(
      bankerCards
    );

  const natural =
    playerInitial >= 8 ||
    bankerInitial >= 8;

  // ----------------------------------------------------------
  // THIRD CARDS
  // ----------------------------------------------------------

  if (!natural) {
    if (
      playerDraws(
        playerInitial
      )
    ) {
      const third =
        await drawCards(roomId, 1);

      playerThird =
        third.cards[0];

      playerCards.push(
        playerThird
      );
    }

    if (playerThird) {
      if (
        bankerDrawsWithPlayerThird(
          bankerInitial,
          playerThird.value
        )
      ) {
        const third =
          await drawCards(roomId, 1);

        bankerThird =
          third.cards[0];

        bankerCards.push(
          bankerThird
        );
      }
    } else if (
      bankerDrawsWithoutPlayerThird(
        bankerInitial
      )
    ) {
      const third =
        await drawCards(roomId, 1);

      bankerThird =
        third.cards[0];

      bankerCards.push(
        bankerThird
      );
    }
  }

  // ----------------------------------------------------------
  // FINAL TOTALS
  // ----------------------------------------------------------

  const playerTotal =
    baccaratTotal(
      playerCards
    );

  const bankerTotal =
    baccaratTotal(
      bankerCards
    );

  const result: BetType =
    playerTotal >
    bankerTotal
      ? "PLAYER"
      : bankerTotal >
          playerTotal
        ? "BANKER"
        : "TIE";

  const finalShoe =
    await getStoredShoeState(roomId);

  const shoeNumber =
    finalShoe?.shoeNumber ??
    initial.shoeNumber ??
    1;

  // ----------------------------------------------------------
  // PROVABLY FAIR COMMITMENT
  // ----------------------------------------------------------
  // The commitment is created from the exact round payload.
  // The hash is visible before betting closes; the payload is
  // only returned after the round reaches RESULT.
  // ----------------------------------------------------------

  const commitmentPayload = {
    roundId,
    shoeNumber,
    position: commitmentStartPosition,
    playerCards: playerCards.map((card) => card.display),
    bankerCards: bankerCards.map((card) => card.display),
  };

  const {
    data: commitmentData,
    error: commitmentError,
  } = await supabase.rpc(
    "baccarat_create_commitment",
    {
      p_round_id: roundId,
      p_shoe_number: shoeNumber,
      p_position: commitmentPayload.position,
      p_player_cards: playerCards.map((card) => card.display),
      p_banker_cards: bankerCards.map((card) => card.display),
    }
  );

  if (commitmentError) {
    throw new Error(
      `Failed to create Baccarat fairness commitment: ${commitmentError.message}`
    );
  }

  const commitmentHash = String(commitmentData ?? "");

  // ----------------------------------------------------------
  // UPDATE ROUND
  // ----------------------------------------------------------

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "baccarat_rounds"
      )
      .update({
        player_card_1:
          playerCards[0]
            ?.display ??
          null,

        player_card_2:
          playerCards[1]
            ?.display ??
          null,

        player_card_3:
          playerThird?.display ??
          null,

        banker_card_1:
          bankerCards[0]
            ?.display ??
          null,

        banker_card_2:
          bankerCards[1]
            ?.display ??
          null,

        banker_card_3:
          bankerThird?.display ??
          null,

        player_total:
          playerTotal,

        banker_total:
          bankerTotal,

        result,

        shoe_number:
          shoeNumber,

        commitment_hash:
          commitmentHash,

        commitment_shoe_number:
          shoeNumber,

        commitment_position:
          commitmentPayload.position,

        commitment_payload:
          commitmentPayload,
      })
      .eq(
        "room_id",
        roomId
      )
      .eq(
        "round_id",
        roundId
      )
      .select("*")
      .single();

  if (error) {
    throw new Error(
      `Failed to complete Baccarat round creation: ${error.message}`
    );
  }

  return data;
}

// ============================================================
// CREATE ROUND
// ============================================================
//
// IMPORTANT:
//
// player_total and banker_total are NOT NULL in the database.
//
// Therefore the new round starts with:
//
// player_total = 0
// banker_total = 0
//
// They are replaced by the actual Baccarat totals after cards
// are drawn.
//
// ============================================================

async function createNewRound(
  roomId: number
): Promise<any> {
  return await withRoomRoundLock(
    roomId,
    async () => {
      // ------------------------------------------------------
      // FAST PATH
      // ------------------------------------------------------

      const existing =
        await getActiveRound(
          roomId
        );

      if (existing) {
        if (
          isRoundPopulated(
            existing
          )
        ) {
          return existing;
        }

        return await populateNewRound(
          existing
        );
      }

      // ------------------------------------------------------
      // CREATE NEW ROW
      // ------------------------------------------------------

      const now =
        new Date();

      const bettingEndsAt =
        new Date(
          now.getTime() +
            BETTING_SECONDS *
              1000
        );

      const roundId =
        createRoundId();

      const {
        data,
        error,
      } =
        await supabase
          .from(
            "baccarat_rounds"
          )
          .insert({
            room_id:
              roomId,

            round_id:
              roundId,

            status:
              "BETTING",

            phase_started_at:
              now.toISOString(),

            betting_ends_at:
              bettingEndsAt.toISOString(),

            // ------------------------------------------------
            // Cards start empty.
            // ------------------------------------------------

            player_card_1:
              null,

            player_card_2:
              null,

            player_card_3:
              null,

            banker_card_1:
              null,

            banker_card_2:
              null,

            banker_card_3:
              null,

            // ------------------------------------------------
            // IMPORTANT:
            // These columns are NOT NULL.
            //
            // 0 means the round has been created but the
            // cards have not yet been populated.
            // ------------------------------------------------

            player_total:
              0,

            banker_total:
              0,

            result:
              null,

            // ------------------------------------------------
            // Also keep this non-null.
            // ------------------------------------------------

            shoe_number:
              1,

            commitment_hash:
              null,

            commitment_shoe_number:
              null,

            commitment_position:
              null,

            commitment_payload:
              null,

            settled_at:
              null,
          })
          .select("*")
          .single();

      // ------------------------------------------------------
      // ANOTHER REQUEST WON THE DATABASE RACE
      // ------------------------------------------------------

      if (error) {
        if (
          isActiveRoundConflict(
            error
          )
        ) {
          const active =
            await waitForActiveRound(
              roomId,
              3000
            );

          if (active) {
            if (
              isRoundPopulated(
                active
              )
            ) {
              return active;
            }

            return await populateNewRound(
              active
            );
          }

          // --------------------------------------------------
          // One final read.
          // --------------------------------------------------

          const finalActive =
            await getActiveRound(
              roomId
            );

          if (finalActive) {
            if (
              isRoundPopulated(
                finalActive
              )
            ) {
              return finalActive;
            }

            return await populateNewRound(
              finalActive
            );
          }

          // --------------------------------------------------
          // If no active round exists after a UNIQUE conflict,
          // surface the actual database problem rather than
          // hiding it behind a generic retry error.
          // --------------------------------------------------

          const latest =
            await getLatestRound(
              roomId
            );

          if (
            latest &&
            latest.status ===
              "RESULT"
          ) {
            throw new Error(
              `Baccarat room ${roomId} has a database active-round index conflict. The latest round is RESULT but PostgreSQL is still blocking creation of a new active round. Check baccarat_one_active_round_idx.`
            );
          }

          throw new Error(
            `Baccarat round creation was blocked by another request for room ${roomId}, but no active round became visible.`
          );
        }

        throw new Error(
          `Failed to create Baccarat round: ${error.message}`
        );
      }

      // ------------------------------------------------------
      // WE CREATED THE ROUND.
      //
      // Now and ONLY now consume the cards.
      // ------------------------------------------------------

      return await populateNewRound(
        data
      );
    }
  );
}

// ============================================================
// COMPLETE PENDING ROUND
// ============================================================

async function completePendingRound(
  round: any
): Promise<any> {
  const roomId =
    Number(
      round.room_id
    );

  if (isRoundPopulated(round)) {
    return round;
  }

  // Another server process may be populating the row. Give it a
  // short opportunity to finish before attempting the population
  // ourselves.
  const started = Date.now();

  while (Date.now() - started < 3000) {
    const latest = await getActiveRound(roomId);

    if (!latest) {
      break;
    }

    if (isRoundPopulated(latest)) {
      return latest;
    }

    await new Promise<void>((resolve) =>
      setTimeout(resolve, 150)
    );
  }

  // Re-check under the room lock. Do not call createNewRound()
  // from inside this lock because createNewRound() acquires the
  // same lock and would deadlock.
  const result = await withRoomRoundLock(
    roomId,
    async () => {
      const lockedLatest =
        await getActiveRound(roomId);

      if (!lockedLatest) {
        return null;
      }

      if (isRoundPopulated(lockedLatest)) {
        return lockedLatest;
      }

      return await populateNewRound(lockedLatest);
    }
  );

  if (result) {
    return result;
  }

  return await createNewRound(roomId);
}

// ============================================================
// ENSURE ROUND
// ============================================================

async function ensureRound(
  roomId: number
): Promise<any> {
  // createNewRound() and completePendingRound() already acquire
  // the room lock. Do not acquire it here and then call either
  // function, otherwise the same request can wait on itself.
  const active = await getActiveRound(roomId);

  if (active) {
    if (isRoundPopulated(active)) {
      return active;
    }

    return await completePendingRound(active);
  }

  const latest = await getLatestRound(roomId);

  if (
    latest &&
    latest.status === "RESULT" &&
    latest.settled_at
  ) {
    const resultFinishedAt =
      new Date(latest.settled_at).getTime();

    if (Date.now() - resultFinishedAt < RESULT_HOLD_MS) {
      return latest;
    }
  }

  return await createNewRound(roomId);
}

// ============================================================
// ROUND PHASE
// ============================================================

function getRoundPhase(
  round: any
): {
  phase: BaccaratPhase;
  remainingMs: number;
  remainingSeconds: number;
  revealIndex: number;
  revealSequence: string[];
  finished: boolean;
} {
  const now =
    Date.now();

  const bettingEnds =
    new Date(
      round.betting_ends_at
    ).getTime();

  // ----------------------------------------------------------
  // BETTING
  // ----------------------------------------------------------

  if (
    now <
    bettingEnds
  ) {
    const remainingMs =
      Math.max(
        0,
        bettingEnds -
          now
      );

    return {
      phase:
        "BETTING",

      remainingMs,

      remainingSeconds:
        Math.ceil(
          remainingMs /
            1000
        ),

      revealIndex:
        -1,

      revealSequence:
        [],

      finished:
        false,
    };
  }

  // ----------------------------------------------------------
  // REVEAL
  // ----------------------------------------------------------

  const revealSequence: string[] =
    [
      "player_card_1",
      "banker_card_1",
      "player_card_2",
      "banker_card_2",
    ];

  if (
    round.player_card_3
  ) {
    revealSequence.push(
      "player_card_3"
    );
  }

  if (
    round.banker_card_3
  ) {
    revealSequence.push(
      "banker_card_3"
    );
  }

  const revealIndex =
    Math.floor(
      (now -
        bettingEnds) /
        CARD_REVEAL_MS
    );

  const finished =
    revealIndex >=
    revealSequence.length;

  if (!finished) {
    return {
      phase:
        "DEALING",

      remainingMs:
        0,

      remainingSeconds:
        0,

      revealIndex,

      revealSequence,

      finished:
        false,
    };
  }

  return {
    phase:
      "RESULT",

    remainingMs:
      0,

    remainingSeconds:
      0,

    revealIndex,

    revealSequence,

    finished:
      true,
  };
}

// ============================================================
// SYNC ROUND STATUS
// ============================================================

async function syncRoundStatus(
  round: any
): Promise<any> {
  const phase =
    getRoundPhase(
      round
    );

  if (
    phase.phase ===
    round.status
  ) {
    return round;
  }

  if (
    round.status ===
    "RESULT"
  ) {
    return round;
  }

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "baccarat_rounds"
      )
      .update({
        status:
          phase.phase,
      })
      .eq(
        "round_id",
        round.round_id
      )
      .eq(
        "room_id",
        round.room_id
      )
      .select("*")
      .single();

  if (error) {
    const fresh =
      await getActiveRound(
        Number(
          round.room_id
        )
      );

    if (fresh) {
      return fresh;
    }

    throw new Error(
      `Failed to sync Baccarat round: ${error.message}`
    );
  }

  return data ??
    round;
}

// ============================================================
// SETTLE
// ============================================================

async function settleRound(
  roundId: string,
  roomId: number
): Promise<any> {
  const {
    data,
    error,
  } =
    await supabase.rpc(
      "baccarat_settle_round",
      {
        p_round_id:
          roundId,
      }
    );

  if (error) {
    throw new Error(
      `Failed to settle Baccarat round: ${error.message}`
    );
  }

  return data;
}

// ============================================================
// ROOM BETS
// ============================================================

async function getRoomBets(
  roomId: number,
  roundId: string
): Promise<{
  bets: any[];
  totals: {
    player: number;
    banker: number;
    tie: number;
    total: number;
  };
}> {
  const {
    data,
    error,
  } =
    await supabase
      .from(
        "baccarat_bets"
      )
      .select(
        "id, round_id, room_id, wallet_address, bet_type, amount, payout, settled, created_at, settled_at"
      )
      .eq(
        "room_id",
        roomId
      )
      .eq(
        "round_id",
        roundId
      )
      .order(
        "created_at",
        {
          ascending:
            false,
        }
      )
      .limit(500);

  if (error) {
    throw new Error(
      `Failed to load Baccarat bets: ${error.message}`
    );
  }

  const bets =
    data ?? [];

  const totals = {
    player: 0,
    banker: 0,
    tie: 0,
    total: 0,
  };

  for (
    const bet of bets
  ) {
    const amount =
      Number(
        bet.amount
      ) || 0;

    if (
      bet.bet_type ===
      "PLAYER"
    ) {
      totals.player +=
        amount;
    } else if (
      bet.bet_type ===
      "BANKER"
    ) {
      totals.banker +=
        amount;
    } else if (
      bet.bet_type ===
      "TIE"
    ) {
      totals.tie +=
        amount;
    }
  }

  totals.total =
    totals.player +
    totals.banker +
    totals.tie;

  return {
    bets,
    totals,
  };
}

// ============================================================
// ROOM EXPOSURE
// ============================================================

function calculateExposure(
  bets: any[]
): number {
  let exposure = 0;

  for (
    const bet of bets
  ) {
    const amount =
      Number(
        bet.amount
      ) || 0;

    if (
      bet.bet_type ===
      "PLAYER"
    ) {
      exposure +=
        amount;
    } else if (
      bet.bet_type ===
      "BANKER"
    ) {
      exposure +=
        amount * 0.95;
    } else if (
      bet.bet_type ===
      "TIE"
    ) {
      exposure +=
        amount * 8;
    }
  }

  return exposure;
}

// ============================================================
// PLAYER ROUND EXPOSURE
// ============================================================

async function getPlayerRoundExposure(
  roomId: number,
  roundId: string,
  walletAddress: string
): Promise<number> {
  const normalizedWallet =
    walletAddress
      .trim()
      .toLowerCase();

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "baccarat_bets"
      )
      .select(
        "amount, wallet_address"
      )
      .eq(
        "room_id",
        roomId
      )
      .eq(
        "round_id",
        roundId
      );

  if (error) {
    throw new Error(
      `Failed to calculate player exposure: ${error.message}`
    );
  }

  return (
    data ?? []
  )
    .filter(
      (bet) =>
        String(
          bet.wallet_address
        ).toLowerCase() ===
        normalizedWallet
    )
    .reduce(
      (
        total: number,
        bet: any
      ) =>
        total +
        (Number(
          bet.amount
        ) || 0),
      0
    );
}

// ============================================================
// SHOE RESPONSE
// ============================================================

async function getShoeState(
  roomId: number
): Promise<{
  shoeNumber: number;
  cardsRemaining: number;
  totalCards: number;
  cardsUsed: number;
  autoShuffleThreshold: number;
}> {
  let shoe =
    await getStoredShoeState(roomId);

  if (!shoe) {
    shoe = await shuffleGlobalShoe(roomId);
  }

  return {
    shoeNumber:
      shoe.shoeNumber,

    cardsRemaining:
      shoe.cardsRemaining,

    totalCards:
      SHOE_SIZE,

    cardsUsed:
      SHOE_SIZE -
      shoe.cardsRemaining,

    autoShuffleThreshold:
      AUTO_SHUFFLE_THRESHOLD,
  };
}

// ============================================================
// ROAD HISTORY
// ============================================================

async function getRoadHistory(
  roomId: number
): Promise<
  Array<{
    result: BetType;
    roundId: string;
    roomId: number;
    createdAt: string;
  }>
> {
  const {
    data,
    error,
  } =
    await supabase
      .from(
        "baccarat_rounds"
      )
      .select(
        "round_id, room_id, result, created_at"
      )
      .eq(
        "room_id",
        roomId
      )
      .not(
        "result",
        "is",
        null
      )
      .order(
        "created_at",
        {
          ascending:
            false,
        }
      )
      .limit(
        ROAD_HISTORY_LIMIT
      );

  if (error) {
    throw new Error(
      `Failed to load Baccarat road history: ${error.message}`
    );
  }

  return (
    data ?? []
  )
    .filter(
      (row) =>
        row.result ===
          "PLAYER" ||
        row.result ===
          "BANKER" ||
        row.result ===
          "TIE"
    )
    .map(
      (
        row: any
      ) => ({
        result:
          row.result as BetType,

        roundId:
          row.round_id,

        roomId:
          Number(
            row.room_id
          ),

        createdAt:
          row.created_at,
      })
    )
    .reverse();
}

// ============================================================
// MY TOTALS
// ============================================================

function calculateMyTotals(
  bets: any[],
  walletAddress?: string
): {
  player: number;
  banker: number;
  tie: number;
  total: number;
} {
  const myTotals = {
    player: 0,
    banker: 0,
    tie: 0,
    total: 0,
  };

  if (!walletAddress) {
    return myTotals;
  }

  const normalizedWallet =
    walletAddress
      .trim()
      .toLowerCase();

  for (
    const bet of bets
  ) {
    if (
      String(
        bet.wallet_address
      ).toLowerCase() !==
      normalizedWallet
    ) {
      continue;
    }

    const amount =
      Number(
        bet.amount
      ) || 0;

    if (
      bet.bet_type ===
      "PLAYER"
    ) {
      myTotals.player +=
        amount;
    } else if (
      bet.bet_type ===
      "BANKER"
    ) {
      myTotals.banker +=
        amount;
    } else if (
      bet.bet_type ===
      "TIE"
    ) {
      myTotals.tie +=
        amount;
    }
  }

  myTotals.total =
    myTotals.player +
    myTotals.banker +
    myTotals.tie;

  return myTotals;
}

// ============================================================
// BUILD RESPONSE
// ============================================================

async function buildResponse(
  room: RoomLimits,
  round: any,
  walletAddress?: string
): Promise<any> {
  const phase =
    getRoundPhase(
      round
    );

  const roomBets =
    await getRoomBets(
      room.id,
      round.round_id
    );

  const shoe =
    await getShoeState(room.id);

  const roadHistory =
    await getRoadHistory(
      room.id
    );

  const myBets =
    walletAddress
      ? roomBets.bets.filter(
          (bet) =>
            String(
              bet.wallet_address
            ).toLowerCase() ===
            walletAddress
              .trim()
              .toLowerCase()
        )
      : [];

  const myTotals =
    calculateMyTotals(
      roomBets.bets,
      walletAddress
    );

  const roomExposure =
    calculateExposure(
      roomBets.bets
    );

  const roomExposureRemaining =
    Math.max(
      0,
      room.maxExposure -
        roomExposure
    );

  const playerRoundExposure =
    walletAddress
      ? await getPlayerRoundExposure(
          room.id,
          round.round_id,
          walletAddress
        )
      : 0;

  return {
    success: true,

    room: getRoomResponse(room),

    limits:
      getLimitsResponse(
        room
      ),

    round: {
      id:
        round.id,

      roomId:
        Number(
          round.room_id
        ),

      roundId:
        round.round_id,

      status:
        round.status,

      phase:
        phase.phase,

      remainingSeconds:
        phase.remainingSeconds,

      remainingMs:
        phase.remainingMs,

      revealIndex:
        phase.revealIndex,

      revealSequence:
        phase.revealSequence,

      bettingEndsAt:
        round.betting_ends_at,

      phaseStartedAt:
        round.phase_started_at,

      cards: {
        player: {
          card1:
            round.player_card_1 ??
            null,

          card2:
            round.player_card_2 ??
            null,

          card3:
            round.player_card_3 ??
            null,
        },

        banker: {
          card1:
            round.banker_card_1 ??
            null,

          card2:
            round.banker_card_2 ??
            null,

          card3:
            round.banker_card_3 ??
            null,
        },
      },

      totals: {
        player:
          Number(
            round.player_total
          ) || 0,

        banker:
          Number(
            round.banker_total
          ) || 0,
      },

      result:
        phase.phase ===
        "RESULT"
          ? round.result
          : null,

      commitment: {
        hash: round.commitment_hash ?? null,
        shoeNumber:
          round.commitment_shoe_number == null
            ? null
            : Number(round.commitment_shoe_number),
        position:
          round.commitment_position == null
            ? null
            : Number(round.commitment_position),
        revealed:
          phase.phase === "RESULT",
        payload:
          phase.phase === "RESULT"
            ? round.commitment_payload ?? null
            : null,
      },
    },

    shoe,

    roadHistory,

    bets:
      roomBets.bets,

    globalTotals:
      roomBets.totals,

    roomTotals:
      roomBets.totals,

    roomExposure,

    roomExposureRemaining,

    playerRoundExposure,

    playerRoundRemaining:
      Math.max(
        0,
        room.maxExposure -
          playerRoundExposure
      ),

    myBets,

    myTotals,
  };
}

// ============================================================
// ERROR RESPONSE
// ============================================================

function errorResponse(
  message: string,
  code: string,
  status = 400,
  extra: Record<
    string,
    unknown
  > = {}
): NextResponse {
  return NextResponse.json(
    {
      success:
        false,

      error:
        message,

      code,

      ...extra,
    },
    {
      status,
    }
  );
}

// ============================================================
// MAP DATABASE BET ERROR
// ============================================================

function mapBetDatabaseError(
  message: string,
  betType: BetType,
  room: RoomLimits
): {
  code: string;
  message: string;
} {
  const lower =
    message.toLowerCase();

  if (
    lower.includes(
      "minimum player"
    )
  ) {
    return {
      code:
        "PLAYER_MIN_BET_NOT_MET",

      message:
        `Minimum PLAYER bet for ${room.roomName} is ${room.minBet.toLocaleString()}.`,
    };
  }

  if (
    lower.includes(
      "maximum player"
    )
  ) {
    return {
      code:
        "PLAYER_MAX_BET_EXCEEDED",

      message:
        `Maximum PLAYER bet for ${room.roomName} is ${room.maxBet.toLocaleString()}.`,
    };
  }

  if (
    lower.includes(
      "minimum banker"
    )
  ) {
    return {
      code:
        "BANKER_MIN_BET_NOT_MET",

      message:
        `Minimum BANKER bet for ${room.roomName} is ${room.minBet.toLocaleString()}.`,
    };
  }

  if (
    lower.includes(
      "maximum banker"
    )
  ) {
    return {
      code:
        "BANKER_MAX_BET_EXCEEDED",

      message:
        `Maximum BANKER bet for ${room.roomName} is ${room.maxBet.toLocaleString()}.`,
    };
  }

  if (
    lower.includes(
      "minimum tie"
    )
  ) {
    return {
      code:
        "TIE_MIN_BET_NOT_MET",

      message:
        `Minimum TIE bet for ${room.roomName} is ${room.tieMinBet.toLocaleString()}.`,
    };
  }

  if (
    lower.includes(
      "maximum tie"
    )
  ) {
    return {
      code:
        "TIE_MAX_BET_EXCEEDED",

      message:
        `Maximum TIE bet for ${room.roomName} is ${room.tieMaxBet.toLocaleString()}.`,
    };
  }

  if (
    lower.includes(
      "maximum room exposure"
    ) ||
    lower.includes(
      "room exposure"
    ) ||
    lower.includes(
      "exposure reached"
    )
  ) {
    return {
      code:
        "ROOM_MAX_EXPOSURE_REACHED",

      message:
        `Maximum room exposure for ${room.roomName} is ${room.maxExposure.toLocaleString()}.`,
    };
  }

  if (
    lower.includes(
      "betting is closed"
    ) ||
    lower.includes(
      "closed"
    ) ||
    lower.includes(
      "expired"
    )
  ) {
    return {
      code:
        "BETTING_CLOSED",

      message:
        "Betting is closed for this round.",
    };
  }

  if (
    lower.includes(
      "insufficient"
    ) ||
    lower.includes(
      "vault balance"
    ) ||
    lower.includes(
      "balance"
    )
  ) {
    return {
      code:
        "INSUFFICIENT_BALANCE",

      message:
        "Insufficient Vault balance.",
    };
  }

  if (
    lower.includes(
      "round not found"
    ) ||
    lower.includes(
      "does not belong"
    )
  ) {
    return {
      code:
        "ROUND_NOT_FOUND",

      message:
        "The Baccarat round is no longer available.",
    };
  }

  return {
    code:
      "BACCARAT_BET_FAILED",

    message:
      message ||
      `Unable to place ${betType} bet.`,
  };
}

// ============================================================
// GET
// ============================================================

export async function GET(
  request: NextRequest
): Promise<NextResponse> {
  try {
    const searchParams =
      request.nextUrl
        .searchParams;

    // --------------------------------------------------------
    // ROOM LIST
    // --------------------------------------------------------

    const rawRoomId =
      searchParams.get(
        "roomId"
      );

    if (!rawRoomId) {
      const rooms =
        await getRooms();

      return NextResponse.json({
        success:
          true,

        rooms,

        count:
          rooms.length,
      });
    }

    // --------------------------------------------------------
    // ROOM ID
    // --------------------------------------------------------

    const roomId =
      parseRoomId(
        rawRoomId
      );

    // --------------------------------------------------------
    // WALLET
    // --------------------------------------------------------

    const walletAddress =
      searchParams.get(
        "walletAddress"
      ) ||
      undefined;

    // --------------------------------------------------------
    // ROOM
    // --------------------------------------------------------

    const room =
      await getRoom(
        roomId
      );

    // --------------------------------------------------------
    // ROUND
    // --------------------------------------------------------

    let round =
      await ensureRound(
        roomId
      );

    round =
      await syncRoundStatus(
        round
      );

    let phase =
      getRoundPhase(
        round
      );

    // --------------------------------------------------------
    // RESULT PHASE
    // --------------------------------------------------------

    if (
      phase.phase ===
      "RESULT"
    ) {
      await settleRound(
        round.round_id,
        roomId
      );

      const settledRound =
        await getLatestRound(
          roomId
        );

      if (settledRound) {
        round =
          settledRound;
      }

      const bettingEnds =
        new Date(
          round.betting_ends_at
        ).getTime();

      const revealCount =
        4 +
        (round.player_card_3
          ? 1
          : 0) +
        (round.banker_card_3
          ? 1
          : 0);

      const dealingDuration =
        revealCount *
        CARD_REVEAL_MS;

      const resultStartedAt =
        bettingEnds +
        dealingDuration;

      if (
        Date.now() -
          resultStartedAt >
        RESULT_HOLD_MS
      ) {
        const active =
          await getActiveRound(roomId);

        if (active) {
          round = isRoundPopulated(active)
            ? active
            : await completePendingRound(active);
        } else {
          round = await createNewRound(roomId);
        }

        round =
          await syncRoundStatus(
            round
          );

        phase =
          getRoundPhase(
            round
          );
      }
    }

    return NextResponse.json(
      await buildResponse(
        room,
        round,
        walletAddress
      )
    );
  } catch (
    error: any
  ) {
    console.error(
      "BACCARAT GET ERROR:",
      error
    );

    const message =
      error?.message ??
      "Baccarat API error";

    return errorResponse(
      message,
      "BACCARAT_GET_FAILED",
      500
    );
  }
}

// ============================================================
// POST
// ============================================================

export async function POST(
  request: NextRequest
): Promise<NextResponse> {
  try {
    const body =
      await request.json();

    const action =
      body?.action;

    // ========================================================
    // BET
    // ========================================================

    if (
      action ===
      "bet"
    ) {
      // ------------------------------------------------------
      // ROOM ID
      // ------------------------------------------------------

      let roomId: number;

      try {
        roomId =
          parseRoomId(
            body?.roomId
          );
      } catch {
        return errorResponse(
          "Baccarat roomId is required.",
          "ROOM_ID_REQUIRED",
          400
        );
      }

      // ------------------------------------------------------
      // ROOM
      // ------------------------------------------------------

      let room: RoomLimits;

      try {
        room =
          await getRoom(
            roomId
          );
      } catch (
        error: any
      ) {
        return errorResponse(
          error?.message ??
            `Baccarat room ${roomId} was not found.`,
          "ROOM_NOT_FOUND",
          404
        );
      }

      // ------------------------------------------------------
      // WALLET
      // ------------------------------------------------------

      const walletAddress =
        String(
          body?.walletAddress ??
            ""
        ).trim();

      if (!walletAddress) {
        return errorResponse(
          "Wallet address is required.",
          "WALLET_REQUIRED",
          400,
          {
            limits:
              getLimitsResponse(
                room
              ),
          }
        );
      }

      // ------------------------------------------------------
      // BET TYPE
      // ------------------------------------------------------

      const betType =
        String(
          body?.betType ??
            ""
        ).toUpperCase() as BetType;

      if (
        !BET_TYPES.includes(
          betType
        )
      ) {
        return errorResponse(
          "Invalid Baccarat bet type. Use PLAYER, BANKER, or TIE.",
          "INVALID_BET_TYPE",
          400,
          {
            limits:
              getLimitsResponse(
                room
              ),
          }
        );
      }

      // ------------------------------------------------------
      // AMOUNT
      // ------------------------------------------------------

      const amount =
        Number(
          body?.amount
        );

      if (
        !Number.isFinite(
          amount
        ) ||
        amount <= 0
      ) {
        return errorResponse(
          "Invalid bet amount.",
          "INVALID_BET_AMOUNT",
          400,
          {
            limits:
              getLimitsResponse(
                room
              ),
          }
        );
      }

      if (
        !Number.isInteger(
          amount
        )
      ) {
        return errorResponse(
          "Bet amount must be a whole number.",
          "BET_AMOUNT_NOT_INTEGER",
          400,
          {
            limits:
              getLimitsResponse(
                room
              ),
          }
        );
      }

      // ------------------------------------------------------
      // PLAYER LIMITS
      // ------------------------------------------------------

      if (
        betType ===
        "PLAYER"
      ) {
        if (
          amount <
          room.minBet
        ) {
          return errorResponse(
            `Minimum PLAYER bet for ${room.roomName} is ${room.minBet.toLocaleString()}.`,
            "PLAYER_MIN_BET_NOT_MET",
            400,
            {
              requestedAmount:
                amount,

              minimumPlayerBet:
                room.minBet,

              maximumPlayerBet:
                room.maxBet,

              limits:
                getLimitsResponse(
                  room
                ),
            }
          );
        }

        if (
          amount >
          room.maxBet
        ) {
          return errorResponse(
            `Maximum PLAYER bet for ${room.roomName} is ${room.maxBet.toLocaleString()}.`,
            "PLAYER_MAX_BET_EXCEEDED",
            400,
            {
              requestedAmount:
                amount,

              minimumPlayerBet:
                room.minBet,

              maximumPlayerBet:
                room.maxBet,

              limits:
                getLimitsResponse(
                  room
                ),
            }
          );
        }
      }

      // ------------------------------------------------------
      // BANKER LIMITS
      // ------------------------------------------------------

      if (
        betType ===
        "BANKER"
      ) {
        if (
          amount <
          room.minBet
        ) {
          return errorResponse(
            `Minimum BANKER bet for ${room.roomName} is ${room.minBet.toLocaleString()}.`,
            "BANKER_MIN_BET_NOT_MET",
            400,
            {
              requestedAmount:
                amount,

              minimumBankerBet:
                room.minBet,

              maximumBankerBet:
                room.maxBet,

              limits:
                getLimitsResponse(
                  room
                ),
            }
          );
        }

        if (
          amount >
          room.maxBet
        ) {
          return errorResponse(
            `Maximum BANKER bet for ${room.roomName} is ${room.maxBet.toLocaleString()}.`,
            "BANKER_MAX_BET_EXCEEDED",
            400,
            {
              requestedAmount:
                amount,

              minimumBankerBet:
                room.minBet,

              maximumBankerBet:
                room.maxBet,

              limits:
                getLimitsResponse(
                  room
                ),
            }
          );
        }
      }

      // ------------------------------------------------------
      // TIE LIMITS
      // ------------------------------------------------------

      if (
        betType ===
        "TIE"
      ) {
        if (
          amount <
          room.tieMinBet
        ) {
          return errorResponse(
            `Minimum TIE bet for ${room.roomName} is ${room.tieMinBet.toLocaleString()}.`,
            "TIE_MIN_BET_NOT_MET",
            400,
            {
              requestedAmount:
                amount,

              minimumTieBet:
                room.tieMinBet,

              maximumTieBet:
                room.tieMaxBet,

              limits:
                getLimitsResponse(
                  room
                ),
            }
          );
        }

        if (
          amount >
          room.tieMaxBet
        ) {
          return errorResponse(
            `Maximum TIE bet for ${room.roomName} is ${room.tieMaxBet.toLocaleString()}.`,
            "TIE_MAX_BET_EXCEEDED",
            400,
            {
              requestedAmount:
                amount,

              minimumTieBet:
                room.tieMinBet,

              maximumTieBet:
                room.tieMaxBet,

              limits:
                getLimitsResponse(
                  room
                ),
            }
          );
        }
      }

      // ------------------------------------------------------
      // ENSURE ACTIVE ROUND
      // ------------------------------------------------------

      const round =
        await ensureRound(
          roomId
        );

      const phase =
        getRoundPhase(
          round
        );

      if (
        phase.phase !==
        "BETTING"
      ) {
        return errorResponse(
          "Betting is closed for this round.",
          "BETTING_CLOSED",
          400,
          {
            roomId,

            roomName:
              room.roomName,

            phase:
              phase.phase,

            roundId:
              round.round_id,

            limits:
              getLimitsResponse(
                room
              ),
          }
        );
      }

      // ------------------------------------------------------
      // DATABASE BET RPC
      // ------------------------------------------------------

      const {
        data,
        error,
      } =
        await supabase.rpc(
          "baccarat_place_room_bet",
          {
            p_room_id:
              roomId,

            p_round_id:
              round.round_id,

            p_wallet_address:
              walletAddress,

            p_bet_type:
              betType,

            p_amount:
              amount,
          }
        );

      if (error) {
        const databaseMessage =
          String(
            error.message ||
              ""
          );

        const mapped =
          mapBetDatabaseError(
            databaseMessage,
            betType,
            room
          );

        return errorResponse(
          mapped.message,
          mapped.code,
          400,
          {
            roomId,

            roomName:
              room.roomName,

            roundId:
              round.round_id,

            betType,

            requestedAmount:
              amount,

            limits:
              getLimitsResponse(
                room
              ),

            databaseError:
              databaseMessage,
          }
        );
      }

      // ------------------------------------------------------
      // REFRESH BETS
      // ------------------------------------------------------

      const updated =
        await getRoomBets(
          roomId,
          round.round_id
        );

      const normalizedWallet =
        walletAddress
          .trim()
          .toLowerCase();

      const myBets =
        updated.bets.filter(
          (bet) =>
            String(
              bet.wallet_address
            ).toLowerCase() ===
            normalizedWallet
        );

      const myTotals =
        calculateMyTotals(
          updated.bets,
          walletAddress
        );

      // ------------------------------------------------------
      // EXPOSURE
      // ------------------------------------------------------

      const roomExposure =
        calculateExposure(
          updated.bets
        );

      const roomExposureRemaining =
        Math.max(
          0,
          room.maxExposure -
            roomExposure
        );

      const playerRoundExposure =
        await getPlayerRoundExposure(
          roomId,
          round.round_id,
          walletAddress
        );

      // ------------------------------------------------------
      // VAULT BALANCE
      // ------------------------------------------------------

      const returnedVaultBalance =
        Number(
          data?.vaultBalance ??
            data?.vault_balance
        );

      let vaultBalance:
        | number
        | null =
        Number.isFinite(
          returnedVaultBalance
        )
          ? returnedVaultBalance
          : null;

      if (
        vaultBalance ===
        null
      ) {
        const {
          data:
            userData,
        } =
          await supabase
            .from(
              "users"
            )
            .select(
              "vault_balance"
            )
            .eq(
              "wallet_address",
              walletAddress
            )
            .maybeSingle();

        vaultBalance =
          Number(
            userData?.vault_balance
          ) || 0;
      }

      // ------------------------------------------------------
      // SUCCESS
      // ------------------------------------------------------

      return NextResponse.json({
        success:
          true,

        message:
          "Baccarat bet placed.",

        room: getRoomResponse(room),

        betId:
          data?.betId ??
          data?.bet_id ??
          null,

        roundId:
          round.round_id,

        betType,

        amount,

        vaultBalance,

        limits:
          getLimitsResponse(
            room
          ),

        playerRoundExposure,

        playerRoundRemaining:
          Math.max(
            0,
            room.maxExposure -
              playerRoundExposure
          ),

        roomExposure,

        roomExposureRemaining,

        bets:
          updated.bets,

        globalTotals:
          updated.totals,

        roomTotals:
          updated.totals,

        myBets,

        myTotals,
      });
    }

    // ========================================================
    // VERIFY COMMITMENT
    // ========================================================

    if (action === "verify_commitment") {
      const roundId = String(body?.roundId ?? "").trim();

      if (!roundId) {
        return errorResponse(
          "roundId is required.",
          "ROUND_ID_REQUIRED",
          400
        );
      }

      const { data: round, error } = await supabase
        .from("baccarat_rounds")
        .select(
          "round_id, room_id, commitment_hash, commitment_shoe_number, commitment_position, commitment_payload, result, settled_at"
        )
        .eq("round_id", roundId)
        .maybeSingle();

      if (error) {
        return errorResponse(
          `Failed to load commitment: ${error.message}`,
          "COMMITMENT_LOOKUP_FAILED",
          500
        );
      }

      if (!round) {
        return errorResponse(
          "Baccarat round was not found.",
          "ROUND_NOT_FOUND",
          404
        );
      }

      if (!round.commitment_hash || !round.commitment_payload) {
        return errorResponse(
          "This Baccarat round does not have a fairness commitment.",
          "COMMITMENT_NOT_AVAILABLE",
          404
        );
      }

      const payload = round.commitment_payload;
      const { data: expectedHash, error: hashError } = await supabase.rpc(
        "baccarat_create_commitment",
        {
          p_round_id: String(payload.roundId),
          p_shoe_number: Number(payload.shoeNumber),
          p_position: Number(payload.position),
          p_player_cards: payload.playerCards ?? [],
          p_banker_cards: payload.bankerCards ?? [],
        }
      );

      if (hashError) {
        return errorResponse(
          `Failed to verify commitment: ${hashError.message}`,
          "COMMITMENT_VERIFY_FAILED",
          500
        );
      }

      const expected = String(expectedHash ?? "");
      const committed = String(round.commitment_hash);

      return NextResponse.json({
        success: true,
        verified: committed === expected,
        roundId,
        commitmentHash: committed,
        calculatedHash: expected,
        payload,
        result: round.result,
        settledAt: round.settled_at,
      });
    }

    // ========================================================
    // MANUAL SHUFFLE DISABLED
    // ========================================================

    if (
      action ===
      "shuffle"
    ) {
      return errorResponse(
        "Manual Baccarat shoe shuffling is disabled. The shoe reshuffles automatically.",
        "MANUAL_SHUFFLE_DISABLED",
        403
      );
    }

    // ========================================================
    // INVALID ACTION
    // ========================================================

    return errorResponse(
      "Invalid Baccarat API action.",
      "INVALID_ACTION",
      400
    );
  } catch (
    error: any
  ) {
    console.error(
      "BACCARAT POST ERROR:",
      error
    );

    return errorResponse(
      error?.message ??
        "Baccarat API error",
      "BACCARAT_POST_FAILED",
      500
    );
  }
}