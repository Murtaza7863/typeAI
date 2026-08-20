import {
  DEFAULT_RACE_SETTINGS,
  RaceClientMessage,
  RacePartyState,
  RacePlayer,
  RaceServerMessage,
  RaceServerMessageSchema,
  RaceSettings,
} from "@typeai/schemas/race";

import {
  clearRaceSession,
  getRaceError,
  getRaceParty,
  getRaceSession,
  setCountdownSeconds,
  setIsRaceActive,
  setLocalFinished,
  setRaceError,
  setRaceParty,
  setRaceSession,
  setRaceStartedAt,
  setRaceWsConnected,
  setRaceYou,
  setStandings,
} from "../states/race";

type MessageHandler = (message: RaceServerMessage) => void;
type TransportMode = "none" | "http";

let handlers: MessageHandler[] = [];
let mode: TransportMode = "none";
let localPlayerId: string | null = null;
let connectPromise: Promise<void> | null = null;
let httpPollTimer: ReturnType<typeof setInterval> | null = null;

function raceHttpUrl(): string {
  return "/api/race-room";
}

function stopHttpPoll(): void {
  if (httpPollTimer === null) return;
  clearInterval(httpPollTimer);
  httpPollTimer = null;
}

function resetLocalRaceState(): void {
  stopHttpPoll();
  clearRaceSession();
  setRaceParty(null);
  setRaceYou(null);
  setStandings([]);
  setLocalFinished(false);
  setCountdownSeconds(null);
  setIsRaceActive(false);
  setRaceStartedAt(null);
  localPlayerId = null;
  setRaceError(null);
}

function startHttpPoll(): void {
  stopHttpPoll();
  httpPollTimer = setInterval(() => {
    void httpRequest({ type: "poll" });
  }, 500);
}

async function tryHttpRace(timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(raceHttpUrl(), {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const data = (await response.json()) as {
      ok?: boolean;
      service?: string;
    };
    return data.ok === true && data.service === "race-room";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

type HttpRoomResponse = {
  ok?: boolean;
  playerId?: string;
  messages?: unknown[];
};

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function applyHttpRoomResponse(data: HttpRoomResponse): void {
  if (typeof data.playerId === "string" && data.playerId.length > 0) {
    localPlayerId = data.playerId;
  }
  for (const raw of data.messages ?? []) {
    const parsed = RaceServerMessageSchema.safeParse(raw);
    if (parsed.success) applyServerMessage(parsed.data);
  }
}

function httpErrorMessage(data: HttpRoomResponse): string | undefined {
  for (const raw of data.messages ?? []) {
    if (
      typeof raw === "object" &&
      raw !== null &&
      "type" in raw &&
      (raw as { type: unknown }).type === "error" &&
      "message" in raw &&
      typeof (raw as { message: unknown }).message === "string"
    ) {
      return (raw as { message: string }).message;
    }
  }
  return undefined;
}

function attachSession(body: Record<string, unknown>): void {
  const type = body["type"];
  if (type === "createParty" || type === "joinParty") return;
  const session = getRaceSession();
  const party = getRaceParty();
  const code = party?.code ?? session?.code;
  const playerId = localPlayerId ?? session?.playerId;
  if (code !== undefined && body["code"] === undefined) body["code"] = code;
  if (playerId !== undefined && body["playerId"] === undefined) {
    body["playerId"] = playerId;
  }
}

async function httpRequest(
  message: Record<string, unknown>,
  apply = true,
): Promise<HttpRoomResponse> {
  const body: Record<string, unknown> = { ...message };
  attachSession(body);

  const response = await fetch(raceHttpUrl(), {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as HttpRoomResponse;
  if (apply) {
    const err = httpErrorMessage(data);
    if (
      body["type"] === "poll" &&
      err !== undefined &&
      /party not found|player not found/i.test(err)
    ) {
      resetLocalRaceState();
      emit({ type: "error", message: err });
      return data;
    }
    applyHttpRoomResponse(data);
  }
  return data;
}

function emit(message: RaceServerMessage): void {
  for (const handler of handlers) {
    handler(message);
  }
}

export function onRaceMessage(handler: MessageHandler): () => void {
  handlers.push(handler);
  return () => {
    handlers = handlers.filter((h) => h !== handler);
  };
}

function applyServerMessage(message: RaceServerMessage): void {
  switch (message.type) {
    case "partyState":
      setRaceParty(message.party);
      setRaceYou(message.you);
      localPlayerId = message.you.id;
      setRaceSession({
        code: message.party.code,
        playerId: message.you.id,
        displayName: message.you.displayName,
      });
      setRaceError(null);
      break;
    case "countdown": {
      setCountdownSeconds(message.seconds);
      {
        const party = getRaceParty();
        if (party !== null) {
          setRaceParty({
            ...party,
            status: "countdown",
            countdownEndsAt: message.endsAt,
          });
        }
      }
      break;
    }
    case "raceStart": {
      setCountdownSeconds(null);
      setLocalFinished(false);
      {
        const party = getRaceParty();
        if (party !== null) {
          setRaceParty({
            ...party,
            status: "racing",
            startedAt: message.startedAt,
            words: message.words,
          });
        }
      }
      break;
    }
    case "progressUpdate": {
      const party = getRaceParty();
      if (party !== null) {
        setRaceParty({
          ...party,
          players: party.players.map((p) =>
            p.id === message.playerId
              ? { ...p, progress: message.progress }
              : p,
          ),
        });
      }
      break;
    }
    case "playerFinished":
      setStandings(message.standings);
      break;
    case "raceComplete": {
      setStandings(message.standings);
      {
        const party = getRaceParty();
        if (party !== null) {
          setRaceParty({
            ...party,
            status: "finished",
            winnerId: message.winnerId,
            players: message.standings,
          });
        }
      }
      break;
    }
    case "error":
      setRaceError(message.message);
      break;
  }

  emit(message);
}

/**
 * Connect both browsers to the shared HTTP race lobby.
 */
export async function connectRaceWs(): Promise<void> {
  if (mode === "http") {
    setRaceWsConnected(true);
    return;
  }
  if (connectPromise !== null) return connectPromise;

  connectPromise = (async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const httpOk = await tryHttpRace(8000);
      if (httpOk) {
        mode = "http";
        setRaceWsConnected(true);
        setRaceError(null);
        return;
      }
      await sleep(400 * (attempt + 1));
    }
    setRaceWsConnected(false);
    setRaceError("Could not reach the race lobby. Refresh and try again.");
  })().finally(() => {
    connectPromise = null;
  });

  await connectPromise;
}

export function disconnectRaceWs(): void {
  stopHttpPoll();
  mode = "none";
  setRaceWsConnected(false);
}

function send(message: RaceClientMessage): void {
  if (mode !== "http") return;
  void httpRequest({ ...message });
}

export async function createParty(
  displayName: string,
  settings: RaceSettings = DEFAULT_RACE_SETTINGS,
): Promise<void> {
  await connectRaceWs();
  if (mode !== "http") {
    setRaceError("Could not reach the race lobby. Refresh and try again.");
    return;
  }
  try {
    await httpRequest({ type: "createParty", displayName, settings });
    if (getRaceParty() !== null) startHttpPoll();
    else if (getRaceError() === null) setRaceError("Failed to create party");
  } catch {
    setRaceError("Failed to create party");
  }
}

export async function joinParty(
  code: string,
  displayName: string,
  playerId?: string,
): Promise<void> {
  await connectRaceWs();
  if (mode !== "http") {
    setRaceError("Could not reach the race lobby. Refresh and try again.");
    return;
  }
  try {
    let lastError = "Failed to join party";
    for (let attempt = 0; attempt < 8; attempt++) {
      const body: Record<string, unknown> = {
        type: "joinParty",
        code: code.toUpperCase(),
        displayName,
      };
      if (playerId !== undefined) body["playerId"] = playerId;
      const data = await httpRequest(body, false);
      const err = httpErrorMessage(data);
      const joined = (data.messages ?? []).some(
        (raw) =>
          typeof raw === "object" &&
          raw !== null &&
          "type" in raw &&
          (raw as { type: unknown }).type === "partyState",
      );
      if (joined) {
        applyHttpRoomResponse(data);
        if (getRaceParty() === null) {
          setRaceError("Joined, but the lobby response was invalid. Refresh.");
          return;
        }
        startHttpPoll();
        return;
      }
      if (err !== undefined) {
        lastError = err;
        if (!/party not found/i.test(err)) {
          applyHttpRoomResponse(data);
          return;
        }
      }
      await sleep(400);
    }
    setRaceError(lastError);
  } catch {
    setRaceError("Failed to join party");
  }
}

export function updateRaceSettings(settings: RaceSettings): void {
  send({ type: "updateSettings", settings });
}

export function startRace(settings?: RaceSettings): void {
  send({ type: "startRace", settings });
}

export function sendProgress(progress: number): void {
  send({ type: "progress", progress });
}

export function sendFinished(timeMs: number): void {
  setLocalFinished(true);
  send({ type: "finished", timeMs });
}

export function leaveParty(): void {
  const session = getRaceSession();
  const party = getRaceParty();
  const code = party?.code ?? session?.code;
  const playerId = localPlayerId ?? session?.playerId;
  if (code !== undefined && playerId !== undefined) {
    void httpRequest({ type: "leave", code, playerId }, false);
  }
  resetLocalRaceState();
}

export type { RacePartyState, RacePlayer };
