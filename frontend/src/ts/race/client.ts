import {
  DEFAULT_RACE_SETTINGS,
  RaceClientMessage,
  RacePartyState,
  RacePlayer,
  RaceServerMessage,
  RaceServerMessageSchema,
  RaceSettings,
} from "@typeai/schemas/race";
import { envConfig } from "virtual:env-config";

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
type TransportMode = "none" | "http" | "ws";

let handlers: MessageHandler[] = [];
let mode: TransportMode = "none";
let localPlayerId: string | null = null;
let connectPromise: Promise<void> | null = null;
let httpPollTimer: ReturnType<typeof setInterval> | null = null;
let requestGeneration = 0;
let rejoinFromPoll = false;
let socket: WebSocket | null = null;
let intentionalClose = false;
let reconnectAttempts = 0;
let socketGeneration = 0;

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

function configuredRaceWsUrl(): string | null {
  const raw = envConfig.raceWsUrl;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sendWs(message: RaceClientMessage): void {
  if (socket === null || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

async function waitForParty(timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(new Error("Timed out waiting for the race server"));
    }, timeoutMs);
    const stop = onRaceMessage((message) => {
      if (message.type === "partyState") {
        clearTimeout(timer);
        stop();
        resolve();
        return;
      }
      if (message.type === "error") {
        clearTimeout(timer);
        stop();
        reject(new Error(message.message));
      }
    });
  });
}

async function wsRequest(message: RaceClientMessage): Promise<void> {
  const pending = waitForParty();
  sendWs(message);
  await pending;
}

function attachSocket(ws: WebSocket): void {
  const generation = ++socketGeneration;
  socket = ws;
  mode = "ws";
  intentionalClose = false;
  setRaceWsConnected(true);
  setRaceError(null);
  ws.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(event.data);
    } catch {
      return;
    }
    const parsed = RaceServerMessageSchema.safeParse(parsedJson);
    if (!parsed.success) {
      console.warn(
        "Dropped invalid race message",
        parsed.error.flatten(),
        parsedJson,
      );
      return;
    }
    applyServerMessage(parsed.data);
  });
  ws.addEventListener("close", () => {
    if (generation !== socketGeneration) return;
    socket = null;
    mode = "none";
    setRaceWsConnected(false);
    if (intentionalClose) return;
    void reconnectOpenSocket();
  });
}

async function openRaceSocket(url: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      ws.close();
      reject(error);
    };
    const timer = window.setTimeout(() => {
      fail(new Error("Could not reach the race server"));
    }, timeoutMs);
    ws.addEventListener("open", () => {
      if (settled) {
        ws.close();
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      attachSocket(ws);
      resolve();
    });
    ws.addEventListener("error", () => {
      fail(new Error("Could not reach the race server"));
    });
  });
}

async function reconnectOpenSocket(): Promise<void> {
  const url = configuredRaceWsUrl();
  const session = getRaceSession();
  if (url === null || session === null) return;
  if (reconnectAttempts >= 3) {
    setRaceError("Lost the race server. Refresh to rejoin.");
    return;
  }
  reconnectAttempts += 1;
  try {
    await openRaceSocket(url, 20000);
    sendWs({
      type: "reconnect",
      code: session.code,
      playerId: session.playerId,
    });
  } catch {
    setRaceError("Lost the race server. Refresh to rejoin.");
  }
}

async function connectConfiguredSocket(): Promise<boolean> {
  const wsUrl = configuredRaceWsUrl();
  if (wsUrl === null) return false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await openRaceSocket(wsUrl, 20000);
      reconnectAttempts = 0;
      setRaceError(null);
      return true;
    } catch {
      await sleep(1000 * (attempt + 1));
    }
  }
  setRaceWsConnected(false);
  setRaceError("Could not reach the race server. Refresh and try again.");
  return true;
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
      const session = getRaceSession();
      if (
        session !== null &&
        /player not found/i.test(err) &&
        !rejoinFromPoll
      ) {
        rejoinFromPoll = true;
        void joinParty(
          session.code,
          session.displayName,
          session.playerId,
        ).finally(() => {
          rejoinFromPoll = false;
        });
        return data;
      }
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
  if (mode === "ws" && socket?.readyState === WebSocket.OPEN) {
    setRaceWsConnected(true);
    return;
  }
  if (connectPromise !== null) return connectPromise;

  connectPromise = (async () => {
    const usedSocket = await connectConfiguredSocket();
    if (usedSocket) return;
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
  intentionalClose = true;
  socket?.close();
  socket = null;
  mode = "none";
  setRaceWsConnected(false);
}

function send(message: RaceClientMessage): void {
  if (mode === "ws") {
    sendWs(message);
    return;
  }
  if (mode !== "http") return;
  void httpRequest({ ...message });
}

export async function createParty(
  displayName: string,
  settings: RaceSettings = DEFAULT_RACE_SETTINGS,
): Promise<void> {
  await connectRaceWs();
  if (mode === "ws") {
    try {
      await wsRequest({ type: "createParty", displayName, settings });
      const code = getRaceParty()?.code;
      if (code !== undefined && code.length > 0) {
        navigationEvent.dispatch({
          url: `/race/${code}`,
          options: { force: true },
        });
      } else if (getRaceError() === null) {
        setRaceError("Failed to create party");
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create party";
      setRaceError(message);
    }
    return;
  }
  if (mode !== "http") {
    if (getRaceError() === null) {
      setRaceError("Could not reach the race lobby. Refresh and try again.");
    }
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
  if (mode === "ws") {
    let lastError = "Failed to join party";
    try {
      for (let attempt = 0; attempt < 8; attempt++) {
        try {
          const normalized = code.toUpperCase();
          const body: RaceClientMessage =
            playerId === undefined
              ? {
                  type: "joinParty",
                  code: normalized,
                  displayName,
                }
              : {
                  type: "joinParty",
                  code: normalized,
                  displayName,
                  playerId,
                };
          await wsRequest(body);
          const joinedCode = getRaceParty()?.code;
          if (joinedCode !== undefined && joinedCode.length > 0) {
            navigationEvent.dispatch({
              url: `/race/${joinedCode}`,
              options: { force: true },
            });
          }
          return;
        } catch (error) {
          lastError =
            error instanceof Error ? error.message : "Failed to join party";
          if (!/party not found/i.test(lastError)) {
            setRaceError(lastError);
            return;
          }
          await sleep(300);
        }
      }
      setRaceError(lastError);
    } catch {
      setRaceError("Failed to join party");
    }
    return;
  }
  if (mode !== "http") {
    if (getRaceError() === null) {
      setRaceError("Could not reach the race lobby. Refresh and try again.");
    }
    return;
  }
  try {
    let lastError = "Failed to join party";
    for (let attempt = 0; attempt < 12; attempt++) {
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
      await sleep(250);
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
  if (mode === "ws") {
    sendWs({ type: "finished", timeMs });
    return;
  }
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
  if (mode === "ws") {
    sendWs({ type: "leave" });
    intentionalClose = true;
    socket?.close();
    socket = null;
    mode = "none";
  } else {
    const session = getRaceSession();
    const party = getRaceParty();
    const code = party?.code ?? session?.code;
    const playerId = localPlayerId ?? session?.playerId;
    if (code !== undefined && playerId !== undefined) {
      void httpRequest({ type: "leave", code, playerId }, false);
    }
  }
  resetLocalRaceState();
}

export function leaveRaceOnPageHide(): void {
  const status = getRaceParty()?.status;
  if (status === "countdown" || status === "racing") return;
  if (mode === "ws") {
    sendWs({ type: "leave" });
    intentionalClose = true;
    socket?.close();
    return;
  }
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
