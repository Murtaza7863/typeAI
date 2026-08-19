/** Vercel function: HTTP race lobby so friends can join without PeerJS/NAT. */

type RaceMode = "words" | "quote";
type RaceWordCount = 25 | 50 | 100;
type RaceSettings = {
  mode: RaceMode;
  wordCount: RaceWordCount;
  punctuation: boolean;
};
type RaceStatus = "lobby" | "countdown" | "racing" | "finished";

type RacePlayer = {
  id: string;
  displayName: string;
  progress: number;
  finishedAt: number | null;
  timeMs: number | null;
  connected: boolean;
  isHost: boolean;
  lastProgressAt: number;
};

type RaceParty = {
  code: string;
  hostId: string;
  status: RaceStatus;
  words: string[];
  settings: RaceSettings;
  players: Record<string, RacePlayer>;
  createdAt: number;
  startedAt: number | null;
  countdownEndsAt: number | null;
  winnerId: string | null;
  finishDeadline: number | null;
  announced: Record<string, RaceStatus>;
};

type ClientMessage = {
  type?: string;
  displayName?: string;
  settings?: Partial<RaceSettings>;
  code?: string;
  playerId?: string;
  progress?: number;
  timeMs?: number;
};

type ServerMessage = Record<string, unknown>;

const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, X-Client-Version",
};

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_PLAYERS = 8;
const COUNTDOWN_MS = 3000;
const FINISH_GRACE_MS = 60_000;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;

const WORDS = [
  "the",
  "be",
  "of",
  "and",
  "a",
  "to",
  "in",
  "he",
  "have",
  "it",
  "that",
  "for",
  "they",
  "with",
  "as",
  "not",
  "on",
  "at",
  "by",
  "this",
  "we",
  "you",
  "do",
  "but",
  "from",
  "or",
  "which",
  "one",
  "would",
  "all",
  "will",
  "there",
  "say",
  "who",
  "make",
  "when",
  "can",
  "more",
  "if",
  "time",
  "up",
  "go",
  "about",
  "than",
  "into",
  "could",
  "only",
  "new",
  "year",
  "some",
  "take",
  "come",
  "know",
  "see",
  "use",
  "get",
  "like",
  "then",
  "work",
  "now",
];

const QUOTES = [
  "The only way to do great work is to love what you do.",
  "In the middle of difficulty lies opportunity.",
  "The journey of a thousand miles begins with a single step.",
  "Stay hungry, stay foolish.",
  "It always seems impossible until it is done.",
];

const rooms: Map<string, RaceParty> = (() => {
  const g = globalThis as { __typeaiRaceRooms?: Map<string, RaceParty> };
  g.__typeaiRaceRooms ??= new Map<string, RaceParty>();
  return g.__typeaiRaceRooms;
})();

export function resetRaceRoomsForTests(): void {
  rooms.clear();
}

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...CORS_HEADERS,
    },
  });
}

function defaultSettings(): RaceSettings {
  return { mode: "words", wordCount: 50, punctuation: false };
}

function parseSettings(raw: Partial<RaceSettings> | undefined): RaceSettings {
  const base = defaultSettings();
  const mode = raw?.mode === "quote" ? "quote" : "words";
  const wordCount =
    raw?.wordCount === 25 || raw?.wordCount === 100 ? raw.wordCount : 50;
  return {
    mode,
    wordCount,
    punctuation: raw?.punctuation === true,
  };
}

function makeCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

function generateWords(settings: RaceSettings): string[] {
  if (settings.mode === "quote") {
    const quote =
      QUOTES[Math.floor(Math.random() * QUOTES.length)] ?? QUOTES[0] ?? "Go.";
    return quote.split(/\s+/).filter((w) => w.length > 0);
  }
  const words: string[] = [];
  let previous = "";
  while (words.length < settings.wordCount) {
    const word = WORDS[Math.floor(Math.random() * WORDS.length)] ?? "the";
    if (word === previous) continue;
    words.push(word);
    previous = word;
  }
  if (!settings.punctuation) return words;
  const out = [...words];
  const first = out[0];
  if (first !== undefined && first.length > 0) {
    out[0] = first.charAt(0).toUpperCase() + first.slice(1);
  }
  const lastIdx = out.length - 1;
  const last = out[lastIdx];
  if (last !== undefined && !/[.!?]$/.test(last)) {
    out[lastIdx] = `${last}.`;
  }
  return out;
}

function playersList(party: RaceParty): Omit<RacePlayer, "lastProgressAt">[] {
  return Object.values(party.players).map(
    ({ lastProgressAt: _l, ...player }) => player,
  );
}

function standings(party: RaceParty): Omit<RacePlayer, "lastProgressAt">[] {
  return playersList(party).sort((a, b) => {
    if (typeof a.timeMs === "number" && typeof b.timeMs === "number") {
      return a.timeMs - b.timeMs;
    }
    if (typeof a.timeMs === "number") return -1;
    if (typeof b.timeMs === "number") return 1;
    return b.progress - a.progress;
  });
}

function inviteUrl(request: Request, code: string): string {
  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    "typeaiapp.vercel.app";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}/race/${code}`;
}

function publicPlayer(player: RacePlayer): Omit<RacePlayer, "lastProgressAt"> {
  const { lastProgressAt: _l, ...rest } = player;
  return rest;
}

function partyState(
  party: RaceParty,
  you: RacePlayer,
  request: Request,
): ServerMessage {
  return {
    type: "partyState",
    party: {
      code: party.code,
      status: party.status,
      hostId: party.hostId,
      words: party.words,
      settings: party.settings,
      players: playersList(party),
      inviteUrl: inviteUrl(request, party.code),
      startedAt: party.startedAt,
      countdownEndsAt: party.countdownEndsAt,
      winnerId: party.winnerId,
    },
    you: publicPlayer(you),
  };
}

function prune(now: number): void {
  for (const [code, party] of rooms) {
    if (now - party.createdAt > ROOM_TTL_MS) rooms.delete(code);
  }
}

function allDone(party: RaceParty): boolean {
  return Object.values(party.players).every(
    (player) => !player.connected || typeof player.timeMs === "number",
  );
}

function completeRace(party: RaceParty): void {
  if (party.status === "finished") return;
  party.status = "finished";
  party.finishDeadline = null;
  const ranked = standings(party);
  party.winnerId =
    party.winnerId ??
    ranked.find((p) => typeof p.timeMs === "number")?.id ??
    null;
}

function advance(party: RaceParty, now: number): void {
  if (
    party.status === "countdown" &&
    party.countdownEndsAt !== null &&
    now >= party.countdownEndsAt
  ) {
    party.status = "racing";
    party.startedAt = now;
    party.countdownEndsAt = null;
    for (const player of Object.values(party.players)) {
      player.progress = 0;
      player.finishedAt = null;
      player.timeMs = null;
    }
  }
  if (party.status === "racing" && allDone(party)) {
    completeRace(party);
  }
  if (
    party.status === "racing" &&
    party.finishDeadline !== null &&
    now >= party.finishDeadline
  ) {
    completeRace(party);
  }
}

function eventsFor(party: RaceParty, playerId: string): ServerMessage[] {
  const previous = party.announced[playerId];
  if (previous === party.status) return [];
  party.announced[playerId] = party.status;
  if (party.status === "countdown") {
    const endsAt = party.countdownEndsAt ?? Date.now() + COUNTDOWN_MS;
    return [
      {
        type: "countdown",
        endsAt,
        seconds: Math.max(1, Math.ceil((endsAt - Date.now()) / 1000)),
      },
    ];
  }
  if (party.status === "racing") {
    return [
      {
        type: "raceStart",
        startedAt: party.startedAt ?? Date.now(),
        words: party.words,
        settings: party.settings,
      },
    ];
  }
  if (party.status === "finished") {
    return [
      {
        type: "raceComplete",
        winnerId: party.winnerId,
        standings: standings(party),
      },
    ];
  }
  return [];
}

function reply(party: RaceParty, playerId: string, request: Request): Response {
  const you = party.players[playerId];
  if (you === undefined) {
    return jsonResponse(200, {
      ok: false,
      messages: [{ type: "error", message: "Player not found" }],
    });
  }
  advance(party, Date.now());
  const messages = [
    partyState(party, you, request),
    ...eventsFor(party, playerId),
  ];
  return jsonResponse(200, { ok: true, playerId, messages });
}

function error(message: string): Response {
  return jsonResponse(200, {
    ok: false,
    messages: [{ type: "error", message }],
  });
}

function handleCreate(body: ClientMessage, request: Request): Response {
  const settings = parseSettings(body.settings);
  let code = makeCode();
  for (let i = 0; i < 12 && rooms.has(code); i++) code = makeCode();
  const playerId = crypto.randomUUID();
  const host: RacePlayer = {
    id: playerId,
    displayName: (body.displayName ?? "Host").trim().slice(0, 24) || "Host",
    progress: 0,
    finishedAt: null,
    timeMs: null,
    connected: true,
    isHost: true,
    lastProgressAt: 0,
  };
  const party: RaceParty = {
    code,
    hostId: playerId,
    status: "lobby",
    settings,
    words: generateWords(settings),
    players: { [playerId]: host },
    createdAt: Date.now(),
    startedAt: null,
    countdownEndsAt: null,
    winnerId: null,
    finishDeadline: null,
    announced: { [playerId]: "lobby" },
  };
  rooms.set(code, party);
  return reply(party, playerId, request);
}

function handleJoin(body: ClientMessage, request: Request): Response {
  const code = (body.code ?? "").toUpperCase();
  const party = rooms.get(code);
  if (party === undefined) {
    return error("Party not found — ask the host to keep the race page open.");
  }
  advance(party, Date.now());
  if (
    body.playerId !== undefined &&
    party.players[body.playerId] !== undefined
  ) {
    const existing = party.players[body.playerId];
    if (existing !== undefined) existing.connected = true;
    return reply(party, body.playerId, request);
  }
  if (party.status !== "lobby") return error("Race already started");
  if (Object.keys(party.players).length >= MAX_PLAYERS) {
    return error("Party is full (max 8 players)");
  }
  const playerId = crypto.randomUUID();
  party.players[playerId] = {
    id: playerId,
    displayName: (body.displayName ?? "Player").trim().slice(0, 24) || "Player",
    progress: 0,
    finishedAt: null,
    timeMs: null,
    connected: true,
    isHost: false,
    lastProgressAt: 0,
  };
  party.announced[playerId] = "lobby";
  return reply(party, playerId, request);
}

function requirePartyPlayer(
  body: ClientMessage,
): { party: RaceParty; player: RacePlayer } | Response {
  const code = (body.code ?? "").toUpperCase();
  const party = rooms.get(code);
  if (party === undefined) return error("Party not found");
  advance(party, Date.now());
  const playerId = body.playerId ?? "";
  const player = party.players[playerId];
  if (player === undefined) return error("Player not found");
  return { party, player };
}

function handleAction(body: ClientMessage, request: Request): Response {
  const type = body.type;
  if (type === "createParty") return handleCreate(body, request);
  if (type === "joinParty") return handleJoin(body, request);

  const loaded = requirePartyPlayer(body);
  if (loaded instanceof Response) return loaded;
  const { party, player } = loaded;

  if (type === "poll") return reply(party, player.id, request);

  if (type === "updateSettings") {
    if (!player.isHost) return error("Only the host can change settings");
    if (party.status !== "lobby")
      return error("Can only change settings in the lobby");
    party.settings = parseSettings(body.settings);
    party.words = generateWords(party.settings);
    return reply(party, player.id, request);
  }

  if (type === "startRace") {
    if (!player.isHost) return error("Only the host can start the race");
    if (party.status !== "lobby") return error("Race already started");
    if (Object.keys(party.players).length < 2) {
      return error("Need at least 2 players to start");
    }
    if (body.settings !== undefined) {
      party.settings = parseSettings(body.settings);
      party.words = generateWords(party.settings);
    }
    party.status = "countdown";
    party.countdownEndsAt = Date.now() + COUNTDOWN_MS;
    return reply(party, player.id, request);
  }

  if (type === "progress") {
    if (party.status !== "racing" || typeof player.timeMs === "number") {
      return reply(party, player.id, request);
    }
    const now = Date.now();
    if (now - player.lastProgressAt < 80) {
      return reply(party, player.id, request);
    }
    player.lastProgressAt = now;
    const progress = Math.max(0, Math.min(100, Math.floor(body.progress ?? 0)));
    player.progress = progress;
    return reply(party, player.id, request);
  }

  if (type === "finished") {
    if (party.status !== "racing" || typeof player.timeMs === "number") {
      return reply(party, player.id, request);
    }
    player.progress = 100;
    player.timeMs = Math.max(1, Math.floor(body.timeMs ?? 1));
    player.finishedAt = Date.now();
    party.winnerId ??= player.id;
    party.finishDeadline ??= Date.now() + FINISH_GRACE_MS;
    advance(party, Date.now());
    return reply(party, player.id, request);
  }

  if (type === "leave") {
    if (party.status === "lobby") {
      delete party.players[player.id];
      if (player.id === party.hostId) {
        rooms.delete(party.code);
        return jsonResponse(200, { ok: true, messages: [] });
      }
    } else {
      player.connected = false;
      advance(party, Date.now());
    }
    return jsonResponse(200, { ok: true, messages: [] });
  }

  return error("Unknown race action");
}

export async function handleRaceRoomRequest(
  request: Request,
): Promise<Response> {
  prune(Date.now());
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method === "GET") {
    return jsonResponse(200, {
      ok: true,
      service: "race-room",
      rooms: rooms.size,
    });
  }
  if (request.method !== "POST") {
    return jsonResponse(405, { message: "Method not allowed" });
  }
  let body: ClientMessage;
  try {
    body = (await request.json()) as ClientMessage;
  } catch {
    return jsonResponse(400, { message: "Invalid JSON body" });
  }
  try {
    return handleAction(body, request);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Race room failed";
    return jsonResponse(500, { message });
  }
}

export default {
  fetch: handleRaceRoomRequest,
};
