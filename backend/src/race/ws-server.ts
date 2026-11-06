import { randomUUID } from "crypto";
import { Server as HttpServer, IncomingMessage } from "http";
import { WebSocketServer, WebSocket } from "ws";
import {
  DEFAULT_RACE_SETTINGS,
  RaceClientMessage,
  RaceClientMessageSchema,
  RaceServerMessage,
  RaceSettings,
  RACE_COUNTDOWN_SECONDS,
  RACE_HARD_TIMEOUT_MS,
} from "@typeai/schemas/race";
import Logger from "../utils/logger";
import {
  configuredFrontendOrigin,
  allowedFrontendOrigin,
} from "./frontend-origin";
import {
  forgetParty,
  loadRememberedParties,
  rememberParty,
} from "./party-persist";
import * as Store from "./party-store";
import { generateRaceText } from "./word-list";

type ClientMeta = {
  playerId: string;
  partyCode: string | null;
  origin: string | null;
};

const sockets = new Map<WebSocket, ClientMeta>();
const DISCONNECT_GRACE_MS = 5_000;
const TIME_RESULT_GRACE_MS = 1_500;
const IDLE_AFTER_FINISH_MS = 30_000;
const RESTORE_GRACE_MS = 90_000;
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

Store.setPartyDeletedHook((code) => {
  const pending = saveTimers.get(code);
  if (pending !== undefined) clearTimeout(pending);
  saveTimers.delete(code);
  void forgetParty(code).catch((error: unknown) => {
    console.error("party delete failed", error);
  });
});

function remember(party: Store.RaceParty, immediate = false): void {
  const pending = saveTimers.get(party.code);
  if (pending !== undefined) clearTimeout(pending);
  const write = (): void => {
    saveTimers.delete(party.code);
    void rememberParty(party).catch((error: unknown) => {
      console.error("party save failed", error);
    });
  };
  if (immediate) {
    write();
    return;
  }
  saveTimers.set(party.code, setTimeout(write, 400));
}

function inviteUrl(party: Store.RaceParty): string {
  const frontend = party.hostOrigin ?? configuredFrontendOrigin();
  return `${frontend}/race/${party.code}`;
}

function send(ws: WebSocket, message: RaceServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(party: Store.RaceParty, message: RaceServerMessage): void {
  for (const [socket, meta] of sockets) {
    if (meta.partyCode === party.code) {
      send(socket, message);
    }
  }
}

function partyStatePayload(
  party: Store.RaceParty,
  you: Store.RacePlayerInternal,
): RaceServerMessage {
  const { lastProgressAt: _l, ...youPublic } = you;
  return {
    type: "partyState",
    party: {
      code: party.code,
      status: party.status,
      hostId: party.hostId,
      words: party.words,
      settings: party.settings,
      players: Store.playersList(party),
      inviteUrl: inviteUrl(party),
      startedAt: party.startedAt,
      countdownEndsAt: party.countdownEndsAt,
      winnerId: party.winnerId,
    },
    you: youPublic,
  };
}

function broadcastPartyState(party: Store.RaceParty): void {
  for (const [socket, meta] of sockets) {
    if (meta.partyCode !== party.code) continue;
    const you = party.players.get(meta.playerId);
    if (you === undefined) continue;
    send(socket, partyStatePayload(party, you));
  }
  remember(party);
}

function assignWinner(party: Store.RaceParty): void {
  const ranking = Store.standings(party);
  if (party.settings.mode === "time") {
    party.winnerId = ranking[0]?.id ?? null;
    return;
  }
  party.winnerId =
    ranking.find((p) => p.timeMs !== null && p.timeMs !== undefined)?.id ??
    null;
}

function announceResults(party: Store.RaceParty): void {
  assignWinner(party);
  broadcast(party, {
    type: "raceComplete",
    winnerId: party.winnerId,
    standings: Store.standings(party),
  });
  broadcastPartyState(party);
}

function settleTimeMode(party: Store.RaceParty): void {
  if (party.settings.mode !== "time") return;
  const duration = party.settings.time * 1000;
  for (const player of party.players.values()) {
    if (
      !player.connected &&
      (player.timeMs === null || player.timeMs === undefined)
    ) {
      continue;
    }
    player.timeMs ??= duration;
  }
}

function clearIdle(party: Store.RaceParty): void {
  if (party.idleTimeout === null) return;
  clearInterval(party.idleTimeout);
  party.idleTimeout = null;
}

function armIdleWatch(party: Store.RaceParty): void {
  if (party.settings.mode === "time" || party.idleTimeout !== null) return;
  party.idleTimeout = setInterval(() => {
    if (party.status !== "racing") {
      clearIdle(party);
      return;
    }
    if (!Store.stalledAfterFinish(party, Date.now(), IDLE_AFTER_FINISH_MS)) {
      return;
    }
    completeRace(party);
  }, 5_000);
}

function completeRace(party: Store.RaceParty): void {
  if (party.status === "finished") return;
  clearIdle(party);
  settleTimeMode(party);
  party.status = "finished";
  if (party.finishTimeout !== null) {
    clearTimeout(party.finishTimeout);
    party.finishTimeout = null;
  }
  announceResults(party);
  remember(party, true);
}

function maybeCompleteRace(party: Store.RaceParty): void {
  if (party.status !== "racing") return;
  if (Store.allFinishedOrDisconnected(party)) {
    completeRace(party);
  }
}

function armHardTimeout(party: Store.RaceParty): void {
  if (party.finishTimeout !== null) {
    clearTimeout(party.finishTimeout);
    party.finishTimeout = null;
  }
  const limitMs =
    party.settings.mode === "time"
      ? party.settings.time * 1000 + TIME_RESULT_GRACE_MS
      : RACE_HARD_TIMEOUT_MS;
  party.finishTimeout = setTimeout(() => {
    party.finishTimeout = null;
    if (party.status === "racing") completeRace(party);
  }, limitMs);
}

function handleCreateParty(
  ws: WebSocket,
  displayName: string,
  settings?: RaceSettings,
): void {
  const meta = sockets.get(ws);
  if (meta === undefined) return;

  if (meta.partyCode !== null) {
    const existing = Store.getParty(meta.partyCode);
    if (existing !== undefined) {
      Store.removePlayer(existing, meta.playerId);
      broadcastPartyState(existing);
    }
  }

  const playerId = randomUUID();
  meta.playerId = playerId;
  const party = Store.createParty(
    playerId,
    displayName,
    settings ?? DEFAULT_RACE_SETTINGS,
  );
  meta.partyCode = party.code;
  party.hostOrigin = meta.origin;
  const you = party.players.get(playerId);
  if (you === undefined) {
    send(ws, { type: "error", message: "Failed to create party" });
    return;
  }
  send(ws, partyStatePayload(party, you));
}

function handleJoinParty(
  ws: WebSocket,
  code: string,
  displayName: string,
  existingPlayerId?: string,
): void {
  const meta = sockets.get(ws);
  if (meta === undefined) return;

  const party = Store.getParty(code);
  if (party === undefined) {
    send(ws, { type: "error", message: "Party not found" });
    return;
  }

  try {
    if (existingPlayerId !== undefined) {
      const reconnected = Store.reconnectPlayer(party, existingPlayerId);
      if (reconnected !== undefined) {
        meta.playerId = existingPlayerId;
        meta.partyCode = party.code;
        broadcastPartyState(party);
        return;
      }
    }

    const playerId = randomUUID();
    meta.playerId = playerId;
    Store.addPlayer(party, playerId, displayName);
    meta.partyCode = party.code;
    broadcastPartyState(party);
  } catch (e) {
    send(ws, {
      type: "error",
      message: e instanceof Error ? e.message : "Failed to join party",
    });
  }
}

function handleReconnect(ws: WebSocket, code: string, playerId: string): void {
  const meta = sockets.get(ws);
  if (meta === undefined) return;

  const party = Store.getParty(code);
  if (party === undefined) {
    send(ws, { type: "error", message: "Party not found" });
    return;
  }

  const player = Store.reconnectPlayer(party, playerId);
  if (player === undefined) {
    send(ws, { type: "error", message: "Player not found in party" });
    return;
  }

  meta.playerId = playerId;
  meta.partyCode = party.code;
  send(ws, partyStatePayload(party, player));
  broadcastPartyState(party);
}

function handleStartRace(ws: WebSocket, settings?: RaceSettings): void {
  const meta = sockets.get(ws);
  if (meta === undefined || meta.partyCode === null) return;

  const party = Store.getParty(meta.partyCode);
  if (party === undefined) {
    send(ws, { type: "error", message: "Party not found" });
    return;
  }
  if (meta.playerId !== party.hostId) {
    send(ws, { type: "error", message: "Only the host can start the race" });
    return;
  }
  if (party.status !== "lobby") {
    send(ws, { type: "error", message: "Race already started" });
    return;
  }
  const connected = [...party.players.values()].filter(
    (player) => player.connected,
  ).length;
  if (connected < 2) {
    send(ws, { type: "error", message: "Need at least 2 players to start" });
    return;
  }

  if (settings !== undefined) {
    try {
      Store.applySettings(party, settings);
    } catch (e) {
      send(ws, {
        type: "error",
        message: e instanceof Error ? e.message : "Invalid settings",
      });
      return;
    }
  } else {
    party.words = generateRaceText(party.settings);
  }

  party.status = "countdown";
  const endsAt = Date.now() + RACE_COUNTDOWN_SECONDS * 1000;
  party.countdownEndsAt = endsAt;
  broadcast(party, {
    type: "countdown",
    endsAt,
    seconds: RACE_COUNTDOWN_SECONDS,
  });
  broadcastPartyState(party);

  party.countdownTimeout = setTimeout(() => {
    party.countdownTimeout = null;
    startRaceClock(party);
  }, RACE_COUNTDOWN_SECONDS * 1000);
}

function startRaceClock(party: Store.RaceParty): void {
  if (party.status !== "countdown") return;
  party.status = "racing";
  party.startedAt = Date.now();
  party.countdownEndsAt = null;
  for (const player of party.players.values()) {
    player.progress = 0;
    player.finishedAt = null;
    player.timeMs = null;
    player.score = undefined;
  }
  broadcast(party, {
    type: "raceStart",
    startedAt: party.startedAt,
    words: party.words,
    settings: party.settings,
  });
  broadcastPartyState(party);
  armHardTimeout(party);
}

function handleUpdateSettings(ws: WebSocket, settings: RaceSettings): void {
  const meta = sockets.get(ws);
  if (meta === undefined || meta.partyCode === null) return;
  const party = Store.getParty(meta.partyCode);
  if (party === undefined) {
    send(ws, { type: "error", message: "Party not found" });
    return;
  }
  if (meta.playerId !== party.hostId) {
    send(ws, { type: "error", message: "Only the host can change settings" });
    return;
  }
  try {
    Store.applySettings(party, settings);
    broadcastPartyState(party);
  } catch (e) {
    send(ws, {
      type: "error",
      message: e instanceof Error ? e.message : "Invalid settings",
    });
  }
}

function rememberScore(
  player: Store.RacePlayerInternal,
  score: number | undefined,
): void {
  if (score === undefined || !Number.isFinite(score)) return;
  const next = Math.max(0, Math.floor(score));
  player.score = Math.max(player.score ?? 0, next);
}

function handleProgress(ws: WebSocket, progress: number, score?: number): void {
  const meta = sockets.get(ws);
  if (meta === undefined || meta.partyCode === null) return;

  const party = Store.getParty(meta.partyCode);
  if (party === undefined || party.status !== "racing") return;

  const player = party.players.get(meta.playerId);
  if (
    player === undefined ||
    (player.timeMs !== null && player.timeMs !== undefined)
  ) {
    return;
  }

  rememberScore(player, score);
  const now = Date.now();
  if (now - player.lastProgressAt < 100) {
    remember(party);
    return;
  }
  player.lastProgressAt = now;

  const clamped = Math.max(0, Math.min(100, Math.floor(progress)));
  if (clamped === player.progress) {
    remember(party);
    return;
  }
  player.progress = Math.max(player.progress, clamped);

  broadcast(party, {
    type: "progressUpdate",
    playerId: player.id,
    progress: clamped,
  });
  remember(party);
}

function handleFinished(ws: WebSocket, timeMs: number, score?: number): void {
  const meta = sockets.get(ws);
  if (meta === undefined || meta.partyCode === null) return;

  const party = Store.getParty(meta.partyCode);
  if (
    party === undefined ||
    (party.status !== "racing" && party.status !== "finished")
  ) {
    return;
  }

  const player = party.players.get(meta.playerId);
  if (player === undefined) return;
  if (player.timeMs !== null && player.timeMs !== undefined) {
    const previous = player.score ?? 0;
    rememberScore(player, score);
    if ((player.score ?? 0) !== previous && party.status === "finished") {
      announceResults(party);
      remember(party, true);
    }
    return;
  }

  const recordedMs =
    party.settings.mode === "time"
      ? party.settings.time * 1000
      : Math.max(1, Math.floor(timeMs));
  if (party.settings.mode !== "time") {
    player.progress = 100;
  }
  rememberScore(player, score);
  player.timeMs = recordedMs;
  player.finishedAt = Date.now();

  const ranking = Store.standings(party);
  const place =
    ranking.findIndex((p) => p.id === player.id) + 1 || ranking.length;

  broadcast(party, {
    type: "playerFinished",
    playerId: player.id,
    timeMs: recordedMs,
    place,
    standings: ranking,
  });
  broadcastPartyState(party);

  if (party.status === "finished") {
    announceResults(party);
    remember(party, true);
    return;
  }

  maybeCompleteRace(party);
  if (party.status === "racing") armIdleWatch(party);
}

function handlePlayAgain(ws: WebSocket): void {
  const meta = sockets.get(ws);
  if (meta === undefined || meta.partyCode === null) return;

  const party = Store.getParty(meta.partyCode);
  if (party === undefined) {
    send(ws, { type: "error", message: "Party not found" });
    return;
  }
  if (party.status !== "finished") {
    send(ws, {
      type: "error",
      message: "Can only play again after the race finishes",
    });
    return;
  }

  const you = party.players.get(meta.playerId);
  if (you === undefined || !you.connected) {
    send(ws, { type: "error", message: "You are not in this party" });
    return;
  }
  for (const player of party.players.values()) player.isHost = false;
  you.isHost = true;
  party.hostId = you.id;

  Store.resetPartyToLobby(party);
  broadcastPartyState(party);
  remember(party, true);
}

function handleLeave(ws: WebSocket): void {
  const meta = sockets.get(ws);
  if (meta === undefined || meta.partyCode === null) return;

  const party = Store.getParty(meta.partyCode);
  if (party === undefined) {
    meta.partyCode = null;
    return;
  }

  Store.removePlayer(party, meta.playerId);
  meta.partyCode = null;

  const stillExists = Store.getParty(party.code);
  if (stillExists !== undefined) {
    broadcastPartyState(stillExists);
    maybeCompleteRace(stillExists);
  }
}

function handleMessage(ws: WebSocket, raw: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    send(ws, { type: "error", message: "Invalid JSON" });
    return;
  }

  const result = RaceClientMessageSchema.safeParse(parsed);
  if (!result.success) {
    send(ws, { type: "error", message: "Invalid message" });
    return;
  }

  const msg: RaceClientMessage = result.data;
  switch (msg.type) {
    case "createParty":
      handleCreateParty(ws, msg.displayName, msg.settings);
      break;
    case "joinParty":
      handleJoinParty(ws, msg.code, msg.displayName, msg.playerId);
      break;
    case "reconnect":
      handleReconnect(ws, msg.code, msg.playerId);
      break;
    case "updateSettings":
      handleUpdateSettings(ws, msg.settings);
      break;
    case "startRace":
      handleStartRace(ws, msg.settings);
      break;
    case "progress":
      handleProgress(ws, msg.progress, msg.score);
      break;
    case "finished":
      handleFinished(ws, msg.timeMs, msg.score);
      break;
    case "leave":
      handleLeave(ws);
      break;
    case "playAgain":
      handlePlayAgain(ws);
      break;
    case "poll":
      break;
    default: {
      const unreachable: never = msg;
      return unreachable;
    }
  }
}

function dropAbsentPlayers(code: string): void {
  const party = Store.getParty(code);
  if (party === undefined) return;
  if (party.status !== "racing" && party.status !== "countdown") return;
  let changed = false;
  for (const player of party.players.values()) {
    const online = [...sockets.values()].some(
      (meta) => meta.playerId === player.id && meta.partyCode === party.code,
    );
    if (!online && player.connected) {
      player.connected = false;
      changed = true;
    }
  }
  if (!changed) return;
  broadcastPartyState(party);
  maybeCompleteRace(party);
}

function resumeParty(party: Store.RaceParty): void {
  const now = Date.now();
  if (party.status === "countdown" && party.countdownEndsAt !== null) {
    const delay = Math.max(0, party.countdownEndsAt - now);
    party.countdownTimeout = setTimeout(() => {
      party.countdownTimeout = null;
      startRaceClock(party);
    }, delay);
  } else if (party.status === "racing" && party.startedAt !== null) {
    const limit =
      party.settings.mode === "time"
        ? party.settings.time * 1000 + TIME_RESULT_GRACE_MS
        : RACE_HARD_TIMEOUT_MS;
    const delay = Math.max(0, party.startedAt + limit - now);
    party.finishTimeout = setTimeout(() => {
      party.finishTimeout = null;
      if (party.status === "racing") completeRace(party);
    }, delay);
  }
  if (party.status === "racing" || party.status === "countdown") {
    setTimeout(() => {
      const current = Store.getParty(party.code);
      if (current === undefined) return;
      if (current.status !== "racing" && current.status !== "countdown") {
        return;
      }
      dropAbsentPlayers(current.code);
      const after = Store.getParty(party.code);
      if (after === undefined || after.status !== "racing") return;
      const seenAt = Date.now();
      for (const player of after.players.values()) {
        if (
          player.connected &&
          (player.timeMs === null || player.timeMs === undefined)
        ) {
          player.lastProgressAt = seenAt;
        }
      }
      armIdleWatch(after);
    }, RESTORE_GRACE_MS);
  }
}

const restoredParties: Store.RaceParty[] = [];

export async function restoreParties(): Promise<void> {
  try {
    const snapshots = await loadRememberedParties();
    for (const snapshot of snapshots) {
      const party = Store.importParty(snapshot);
      if (party !== undefined) restoredParties.push(party);
    }
  } catch (error) {
    console.error("party restore failed", error);
  }
}

export function resumeRestoredParties(): void {
  for (const party of restoredParties) resumeParty(party);
  restoredParties.length = 0;
}

export function attachRaceWebSocket(server: HttpServer): void {
  const path = process.env["RACE_WS_PATH"] ?? "/race-ws";
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request: IncomingMessage, socket, head) => {
    const url = request.url ?? "";
    if (!url.startsWith(path)) {
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws, request: IncomingMessage) => {
    const header = request.headers.origin;
    sockets.set(ws, {
      playerId: randomUUID(),
      partyCode: null,
      origin: allowedFrontendOrigin(
        typeof header === "string" ? header : undefined,
      ),
    });

    ws.on("message", (data) => {
      const raw =
        typeof data === "string"
          ? data
          : Buffer.isBuffer(data)
            ? data.toString("utf8")
            : Array.isArray(data)
              ? Buffer.concat(data).toString("utf8")
              : Buffer.from(data).toString("utf8");
      handleMessage(ws, raw);
    });

    ws.on("close", () => {
      const meta = sockets.get(ws);
      sockets.delete(ws);
      if (meta === undefined || meta.partyCode === null) return;
      const drop = (): void => {
        if (meta.partyCode === null) return;
        const stillConnected = [...sockets.values()].some(
          (other) =>
            other.playerId === meta.playerId &&
            other.partyCode === meta.partyCode,
        );
        if (stillConnected) return;
        const party = Store.getParty(meta.partyCode);
        if (party === undefined) return;
        Store.removePlayer(party, meta.playerId);
        const still = Store.getParty(party.code);
        if (still !== undefined) {
          broadcastPartyState(still);
          maybeCompleteRace(still);
        }
      };
      const party = Store.getParty(meta.partyCode);
      if (party?.status === "racing") {
        setTimeout(drop, DISCONNECT_GRACE_MS);
        return;
      }
      drop();
    });
  });

  Logger.success(`Race WebSocket listening on path ${path}`);
}
