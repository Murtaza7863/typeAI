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

export type DurableStore = {
  name: string;
  get: (code: string) => Promise<RaceParty | undefined>;
  set: (party: RaceParty) => Promise<void>;
  delete: (code: string) => Promise<void>;
};

const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, X-Client-Version",
};

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_PLAYERS = 8;
const COUNTDOWN_MS = 3000;
const FINISH_GRACE_MS = 60_000;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const ROOM_TTL_SECONDS = Math.floor(ROOM_TTL_MS / 1000);
const STORE_PREFIX = "typeai-race-";
const SETGET_BASE = "https://setget.net";

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

/** `null` = memory only; a store = use it; `undefined` = production default. */
let testDurableStore: DurableStore | null | undefined = undefined;

class RaceStoreError extends Error {
  constructor(message = "Could not reach the race lobby. Retry in a moment.") {
    super(message);
    this.name = "RaceStoreError";
  }
}

export function resetRaceRoomsForTests(): void {
  rooms.clear();
}

export function setRaceDurableStoreForTests(store: DurableStore | null): void {
  testDurableStore = store;
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

function parseSettings(raw: Partial<RaceSettings> | undefined): RaceSettings {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRaceStatus(value: unknown): value is RaceStatus {
  return (
    value === "lobby" ||
    value === "countdown" ||
    value === "racing" ||
    value === "finished"
  );
}

function parsePlayer(value: unknown): RacePlayer | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value["id"] !== "string" || value["id"].length === 0) {
    return undefined;
  }
  if (typeof value["displayName"] !== "string") return undefined;
  return {
    id: value["id"],
    displayName: value["displayName"].slice(0, 24) || "Player",
    progress:
      typeof value["progress"] === "number"
        ? Math.max(0, Math.min(100, value["progress"]))
        : 0,
    finishedAt:
      typeof value["finishedAt"] === "number" ? value["finishedAt"] : null,
    timeMs: typeof value["timeMs"] === "number" ? value["timeMs"] : null,
    connected: value["connected"] !== false,
    isHost: value["isHost"] === true,
    lastProgressAt:
      typeof value["lastProgressAt"] === "number" ? value["lastProgressAt"] : 0,
  };
}

function parseParty(raw: unknown): RaceParty | undefined {
  if (!isRecord(raw) || raw["gone"] === true) return undefined;
  if (typeof raw["code"] !== "string" || raw["code"].length < 4) {
    return undefined;
  }
  if (typeof raw["hostId"] !== "string") return undefined;
  if (!isRaceStatus(raw["status"])) return undefined;
  if (!Array.isArray(raw["words"])) return undefined;
  if (!isRecord(raw["players"])) return undefined;
  if (typeof raw["createdAt"] !== "number") return undefined;
  const players: Record<string, RacePlayer> = {};
  for (const [id, playerRaw] of Object.entries(raw["players"])) {
    const player = parsePlayer(playerRaw);
    if (player === undefined) continue;
    players[id] = player;
  }
  if (Object.keys(players).length === 0) return undefined;
  const announcedRaw = isRecord(raw["announced"]) ? raw["announced"] : {};
  const announced: Record<string, RaceStatus> = {};
  for (const [id, status] of Object.entries(announcedRaw)) {
    if (isRaceStatus(status)) announced[id] = status;
  }
  const settingsRaw = isRecord(raw["settings"])
    ? (raw["settings"] as Partial<RaceSettings>)
    : undefined;
  return {
    code: raw["code"].toUpperCase(),
    hostId: raw["hostId"],
    status: raw["status"],
    words: raw["words"].filter(
      (word): word is string => typeof word === "string",
    ),
    settings: parseSettings(settingsRaw),
    players,
    createdAt: raw["createdAt"],
    startedAt: typeof raw["startedAt"] === "number" ? raw["startedAt"] : null,
    countdownEndsAt:
      typeof raw["countdownEndsAt"] === "number"
        ? raw["countdownEndsAt"]
        : null,
    winnerId: typeof raw["winnerId"] === "string" ? raw["winnerId"] : null,
    finishDeadline:
      typeof raw["finishDeadline"] === "number" ? raw["finishDeadline"] : null,
    announced,
  };
}

function storeKey(code: string): string {
  return `${STORE_PREFIX}${code}`;
}

async function fetchNoStore(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache",
          ...(init?.headers ?? {}),
        },
        signal: AbortSignal.timeout(5000),
      });
      if (response.status !== 429) return response;
      const wait = Number(response.headers.get("Retry-After") ?? "1");
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(250, wait * 1000) * (attempt + 1)),
      );
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
  throw new RaceStoreError();
}

function setgetStore(): DurableStore {
  return {
    name: "setget",
    async get(code) {
      const response = await fetchNoStore(
        `${SETGET_BASE}/get/${storeKey(code)}?format=json`,
      );
      if (response.status === 404) return undefined;
      if (!response.ok) throw new RaceStoreError();
      const payload = (await response.json()) as { value?: unknown };
      return parseParty(payload.value);
    },
    async set(party) {
      const response = await fetchNoStore(
        `${SETGET_BASE}/set/${storeKey(party.code)}?ttl=${ROOM_TTL_SECONDS}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(party),
        },
      );
      if (!response.ok) throw new RaceStoreError();
    },
    async delete(code) {
      const response = await fetchNoStore(
        `${SETGET_BASE}/set/${storeKey(code)}?ttl=1`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gone: true, code }),
        },
      );
      if (!response.ok && response.status !== 404) throw new RaceStoreError();
    },
  };
}

function upstashStore(url: string, token: string): DurableStore {
  const base = url.replace(/\/$/, "");
  async function command(args: unknown[]): Promise<unknown> {
    const response = await fetchNoStore(base, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
    if (!response.ok) throw new RaceStoreError();
    const payload = (await response.json()) as { result?: unknown };
    return payload.result;
  }
  return {
    name: "upstash",
    async get(code) {
      const result = await command(["GET", storeKey(code)]);
      if (typeof result !== "string" || result.length === 0) return undefined;
      try {
        return parseParty(JSON.parse(result));
      } catch {
        return undefined;
      }
    },
    async set(party) {
      await command([
        "SET",
        storeKey(party.code),
        JSON.stringify(party),
        "EX",
        ROOM_TTL_SECONDS,
      ]);
    },
    async delete(code) {
      await command(["DEL", storeKey(code)]);
    },
  };
}

function liveDurableStore(): DurableStore {
  const url =
    process.env["KV_REST_API_URL"] ?? process.env["UPSTASH_REDIS_REST_URL"];
  const token =
    process.env["KV_REST_API_TOKEN"] ?? process.env["UPSTASH_REDIS_REST_TOKEN"];
  if (
    url !== undefined &&
    url.length > 0 &&
    token !== undefined &&
    token.length > 0
  ) {
    return upstashStore(url, token);
  }
  return setgetStore();
}

function durableStore(): DurableStore | null {
  if (testDurableStore !== undefined) return testDurableStore;
  if (process.env["VITEST"] === "true") return null;
  return liveDurableStore();
}

async function loadParty(code: string): Promise<RaceParty | undefined> {
  const store = durableStore();
  if (store !== null) {
    const remote = await store.get(code);
    if (remote === undefined) {
      rooms.delete(code);
      return undefined;
    }
    if (Date.now() - remote.createdAt > ROOM_TTL_MS) {
      await store.delete(code);
      rooms.delete(code);
      return undefined;
    }
    rooms.set(code, remote);
    return remote;
  }
  const local = rooms.get(code);
  if (local !== undefined && Date.now() - local.createdAt > ROOM_TTL_MS) {
    rooms.delete(code);
    return undefined;
  }
  return local;
}

async function saveParty(party: RaceParty): Promise<void> {
  rooms.set(party.code, party);
  const store = durableStore();
  if (store !== null) await store.set(party);
}

async function removeParty(code: string): Promise<void> {
  rooms.delete(code);
  const store = durableStore();
  if (store !== null) await store.delete(code);
}

async function reply(
  party: RaceParty,
  playerId: string,
  request: Request,
): Promise<Response> {
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
  await saveParty(party);
  return jsonResponse(200, { ok: true, playerId, messages });
}

function error(message: string): Response {
  return jsonResponse(200, {
    ok: false,
    messages: [{ type: "error", message }],
  });
}

async function handleCreate(
  body: ClientMessage,
  request: Request,
): Promise<Response> {
  const settings = parseSettings(body.settings);
  let code = makeCode();
  for (let i = 0; i < 12; i++) {
    const existing = await loadParty(code);
    if (existing === undefined) break;
    code = makeCode();
  }
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
  await saveParty(party);
  return reply(party, playerId, request);
}

async function handleJoin(
  body: ClientMessage,
  request: Request,
): Promise<Response> {
  const code = (body.code ?? "").toUpperCase();
  const party = await loadParty(code);
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

async function requirePartyPlayer(
  body: ClientMessage,
): Promise<{ party: RaceParty; player: RacePlayer } | Response> {
  const code = (body.code ?? "").toUpperCase();
  const party = await loadParty(code);
  if (party === undefined) return error("Party not found");
  advance(party, Date.now());
  const playerId = body.playerId ?? "";
  const player = party.players[playerId];
  if (player === undefined) return error("Player not found");
  return { party, player };
}

async function handleAction(
  body: ClientMessage,
  request: Request,
): Promise<Response> {
  const type = body.type;
  if (type === "createParty") return handleCreate(body, request);
  if (type === "joinParty") return handleJoin(body, request);

  const loaded = await requirePartyPlayer(body);
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
    if (now - player.lastProgressAt < 200) {
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
        await removeParty(party.code);
        return jsonResponse(200, { ok: true, messages: [] });
      }
      await saveParty(party);
    } else {
      player.connected = false;
      advance(party, Date.now());
      await saveParty(party);
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
    const store = durableStore();
    return jsonResponse(200, {
      ok: true,
      service: "race-room",
      store: store?.name ?? "memory",
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
    return await handleAction(body, request);
  } catch (e: unknown) {
    if (e instanceof RaceStoreError) return error(e.message);
    const message = e instanceof Error ? e.message : "Race room failed";
    return jsonResponse(500, { message });
  }
}

export default {
  fetch: handleRaceRoomRequest,
};
