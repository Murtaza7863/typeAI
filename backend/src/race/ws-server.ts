import { randomUUID } from "crypto";
import { Server as HttpServer, IncomingMessage } from "http";
import { WebSocketServer, WebSocket } from "ws";
import {
  RaceClientMessage,
  RaceClientMessageSchema,
  RaceServerMessage,
  RACE_COUNTDOWN_SECONDS,
  RACE_FINISH_TIMEOUT_MS,
} from "@typeai/schemas/race";
import Logger from "../utils/logger";
import * as Store from "./party-store";

type ClientMeta = {
  playerId: string;
  partyCode: string | null;
};

const sockets = new Map<WebSocket, ClientMeta>();

function inviteUrl(code: string): string {
  const frontend = (
    process.env["FRONTEND_URL"] ?? "http://localhost:3000"
  ).replace(/\/$/, "");
  return `${frontend}/race/${code}`;
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
      players: Store.playersList(party),
      inviteUrl: inviteUrl(party.code),
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
}

function completeRace(party: Store.RaceParty): void {
  if (party.status === "finished") return;
  party.status = "finished";
  if (party.finishTimeout !== null) {
    clearTimeout(party.finishTimeout);
    party.finishTimeout = null;
  }
  const ranking = Store.standings(party);
  if (party.winnerId === null) {
    const winner = ranking.find(
      (p) => p.timeMs !== null && p.timeMs !== undefined,
    );
    party.winnerId = winner?.id ?? null;
  }
  broadcast(party, {
    type: "raceComplete",
    winnerId: party.winnerId,
    standings: ranking,
  });
  broadcastPartyState(party);
}

function maybeCompleteRace(party: Store.RaceParty): void {
  if (party.status !== "racing") return;
  if (Store.allFinishedOrDisconnected(party)) {
    completeRace(party);
  }
}

function handleCreateParty(ws: WebSocket, displayName: string): void {
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
  const party = Store.createParty(playerId, displayName);
  meta.partyCode = party.code;
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

function handleStartRace(ws: WebSocket): void {
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
  if (party.players.size < 2) {
    send(ws, { type: "error", message: "Need at least 2 players to start" });
    return;
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
    if (party.status !== "countdown") return;
    party.status = "racing";
    party.startedAt = Date.now();
    party.countdownEndsAt = null;
    for (const player of party.players.values()) {
      player.progress = 0;
      player.finishedAt = null;
      player.timeMs = null;
    }
    broadcast(party, {
      type: "raceStart",
      startedAt: party.startedAt,
      words: party.words,
    });
    broadcastPartyState(party);
  }, RACE_COUNTDOWN_SECONDS * 1000);
}

function handleProgress(ws: WebSocket, progress: number): void {
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

  const now = Date.now();
  if (now - player.lastProgressAt < 100) return;
  player.lastProgressAt = now;

  const clamped = Math.max(0, Math.min(100, Math.floor(progress)));
  if (clamped === player.progress) return;
  player.progress = clamped;

  broadcast(party, {
    type: "progressUpdate",
    playerId: player.id,
    progress: clamped,
  });
}

function handleFinished(ws: WebSocket, timeMs: number): void {
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

  player.progress = 100;
  player.timeMs = timeMs;
  player.finishedAt = Date.now();

  party.winnerId ??= player.id;

  const ranking = Store.standings(party);
  const place =
    ranking.findIndex((p) => p.id === player.id) + 1 || ranking.length;

  broadcast(party, {
    type: "playerFinished",
    playerId: player.id,
    timeMs,
    place,
    standings: ranking,
  });
  broadcastPartyState(party);

  if (Store.connectedUnfinishedCount(party) === 0) {
    completeRace(party);
    return;
  }

  party.finishTimeout ??= setTimeout(() => {
    party.finishTimeout = null;
    maybeCompleteRace(party);
    if (party.status === "racing") {
      completeRace(party);
    }
  }, RACE_FINISH_TIMEOUT_MS);

  maybeCompleteRace(party);
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
      handleCreateParty(ws, msg.displayName);
      break;
    case "joinParty":
      handleJoinParty(ws, msg.code, msg.displayName, msg.playerId);
      break;
    case "reconnect":
      handleReconnect(ws, msg.code, msg.playerId);
      break;
    case "startRace":
      handleStartRace(ws);
      break;
    case "progress":
      handleProgress(ws, msg.progress);
      break;
    case "finished":
      handleFinished(ws, msg.timeMs);
      break;
    case "leave":
      handleLeave(ws);
      break;
  }
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

  wss.on("connection", (ws) => {
    sockets.set(ws, { playerId: randomUUID(), partyCode: null });

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
      const party = Store.getParty(meta.partyCode);
      if (party === undefined) return;
      Store.removePlayer(party, meta.playerId);
      const still = Store.getParty(party.code);
      if (still !== undefined) {
        broadcastPartyState(still);
        maybeCompleteRace(still);
      }
    });
  });

  Logger.success(`Race WebSocket listening on path ${path}`);
}
