import {
  DEFAULT_RACE_SETTINGS,
  RaceClientMessage,
  RacePartyState,
  RacePlayer,
  RaceServerMessage,
  RaceServerMessageSchema,
  RaceSettings,
} from "@typeai/schemas/race";

import { navigationEvent } from "../events/navigation";
import {
  clearRaceSession,
  getRaceError,
  getRaceParty,
  getRaceSession,
  isRaceActive,
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
let requestGeneration = 0;

function raceHttpUrl(): string {
  return "/api/race-room";
}

function stopHttpPoll(): void {
  if (httpPollTimer === null) return;
  clearInterval(httpPollTimer);
  httpPollTimer = null;
}

function resetLocalRaceState(): void {
  requestGeneration += 1;
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
    if (!parsed.success) {
      console.warn("Dropped invalid race message", parsed.error.flatten(), raw);
      continue;
    }
    applyServerMessage(parsed.data);
  }
}

function partyStatusRank(status: RacePartyState["status"]): number {
  if (status === "finished") return 3;
  if (status === "racing") return 2;
  if (status === "countdown") return 1;
  return 0;
}

function shouldApplyPartyState(next: RacePartyState): boolean {
  const current = getRaceParty();
  if (current === null || current.code !== next.code) return true;
  const currentRev = current.rev ?? 0;
  const nextRev = next.rev ?? 0;
  if (nextRev < currentRev) return false;
  if (nextRev > currentRev) return true;
  if (
    partyStatusRank(next.status) < partyStatusRank(current.status) &&
    !(current.status === "finished" && next.status === "lobby")
  ) {
    return false;
  }
  return true;
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
  const generation = requestGeneration;

  const response = await fetch(raceHttpUrl(), {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as HttpRoomResponse;
  if (generation !== requestGeneration) return data;
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
  let skipEmit = false;
  switch (message.type) {
    case "partyState":
      if (!shouldApplyPartyState(message.party)) {
        skipEmit = true;
        break;
      }
      setRaceParty(message.party);
      setRaceYou(message.you);
      localPlayerId = message.you.id;
      setRaceSession({
        code: message.party.code,
        playerId: message.you.id,
        displayName: message.you.displayName,
      });
      setRaceError(null);
      if (message.party.status === "lobby") {
        setLocalFinished(false);
        setStandings([]);
        setCountdownSeconds(null);
        setIsRaceActive(false);
        setRaceStartedAt(null);
      }
      if (message.party.status === "finished") {
        setCountdownSeconds(null);
        if (message.party.players.length > 0) {
          setStandings(message.party.players);
        }
      }
      break;
    case "countdown": {
      if (getRaceParty()?.status === "finished") {
        skipEmit = true;
        break;
      }
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
      if (
        getRaceParty()?.status === "finished" ||
        (isRaceActive() && getRaceParty()?.startedAt === message.startedAt)
      ) {
        skipEmit = true;
        break;
      }
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
            settings: message.settings ?? party.settings,
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
      setCountdownSeconds(null);
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

  if (!skipEmit) emit(message);
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
    if (getRaceParty() !== null) {
      startHttpPoll();
      const code = getRaceParty()?.code;
      if (code !== undefined && code.length > 0) {
        navigationEvent.dispatch({
          url: `/race/${code}`,
          options: { force: true },
        });
      }
    } else if (getRaceError() === null) {
      setRaceError("Failed to create party");
    }
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
        const joinedCode = getRaceParty()?.code;
        if (joinedCode !== undefined && joinedCode.length > 0) {
          navigationEvent.dispatch({
            url: `/race/${joinedCode}`,
            options: { force: true },
          });
        }
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
  void retryFinished(timeMs);
}

async function retryFinished(timeMs: number): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (getRaceSession() === null && getRaceParty() === null) return;
    try {
      const data = await httpRequest({ type: "finished", timeMs });
      const err = httpErrorMessage(data);
      if (err !== undefined && /party not found|player not found/i.test(err)) {
        return;
      }
      if (err === undefined && (data.messages ?? []).length > 0) return;
    } catch {
      // retry
    }
    if (getRaceSession() === null && getRaceParty() === null) return;
    await sleep(400 * (attempt + 1));
  }
}

export function playAgain(): void {
  send({ type: "playAgain" });
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

export function leaveRaceOnPageHide(): void {
  const session = getRaceSession();
  const party = getRaceParty();
  const code = party?.code ?? session?.code;
  const playerId = localPlayerId ?? session?.playerId;
  if (code === undefined || playerId === undefined) return;
  const payload = JSON.stringify({ type: "leave", code, playerId });
  try {
    navigator.sendBeacon(
      raceHttpUrl(),
      new Blob([payload], { type: "application/json" }),
    );
  } catch {
    // page is closing
  }
}

export type { RacePartyState, RacePlayer };
