import {
  RaceClientMessage,
  RacePartyState,
  RacePlayer,
  RaceServerMessage,
  RaceServerMessageSchema,
} from "@typeai/schemas/race";
import { envConfig } from "virtual:env-config";

import {
  clearRaceSession,
  getRaceParty,
  getRaceSession,
  setCountdownSeconds,
  setLocalFinished,
  setRaceError,
  setRaceParty,
  setRaceSession,
  setRaceWsConnected,
  setRaceYou,
  setStandings,
} from "../states/race";

type MessageHandler = (message: RaceServerMessage) => void;

let socket: WebSocket | null = null;
let handlers: MessageHandler[] = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function wsUrl(): string {
  const base = envConfig.backendUrl.replace(/\/$/, "");
  const path = "/race-ws";
  if (base.startsWith("https://")) {
    return `wss://${base.slice("https://".length)}${path}`;
  }
  if (base.startsWith("http://")) {
    return `ws://${base.slice("http://".length)}${path}`;
  }
  return `ws://${base}${path}`;
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

function send(message: RaceClientMessage): void {
  if (socket === null || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

function handleServerMessage(raw: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  const result = RaceServerMessageSchema.safeParse(parsed);
  if (!result.success) return;
  const message = result.data;

  switch (message.type) {
    case "partyState":
      setRaceParty(message.party);
      setRaceYou(message.you);
      setRaceSession({
        code: message.party.code,
        playerId: message.you.id,
        displayName: message.you.displayName,
      });
      setRaceError(null);
      break;
    case "countdown": {
      setCountdownSeconds(message.seconds);
      const party = getRaceParty();
      if (party !== null) {
        setRaceParty({
          ...party,
          status: "countdown",
          countdownEndsAt: message.endsAt,
        });
      }
      break;
    }
    case "raceStart": {
      setCountdownSeconds(null);
      setLocalFinished(false);
      const party = getRaceParty();
      if (party !== null) {
        setRaceParty({
          ...party,
          status: "racing",
          startedAt: message.startedAt,
          words: message.words,
        });
      }
      break;
    }
    case "progressUpdate": {
      const party = getRaceParty();
      if (party === null) break;
      setRaceParty({
        ...party,
        players: party.players.map((p) =>
          p.id === message.playerId ? { ...p, progress: message.progress } : p,
        ),
      });
      break;
    }
    case "playerFinished":
      setStandings(message.standings);
      break;
    case "raceComplete": {
      setStandings(message.standings);
      const party = getRaceParty();
      if (party !== null) {
        setRaceParty({
          ...party,
          status: "finished",
          winnerId: message.winnerId,
          players: message.standings,
        });
      }
      break;
    }
    case "error":
      setRaceError(message.message);
      break;
  }

  emit(message);
}

export async function connectRaceWs(): Promise<void> {
  if (socket !== null && socket.readyState === WebSocket.OPEN) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    try {
      socket = new WebSocket(wsUrl());
    } catch (e) {
      reject(e instanceof Error ? e : new Error("Failed to connect"));
      return;
    }

    socket.onopen = () => {
      setRaceWsConnected(true);
      const session = getRaceSession();
      if (session !== null) {
        send({
          type: "reconnect",
          code: session.code,
          playerId: session.playerId,
        });
      }
      resolve();
    };

    socket.onmessage = (event) => {
      handleServerMessage(String(event.data));
    };

    socket.onclose = () => {
      setRaceWsConnected(false);
      socket = null;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        void connectRaceWs().catch(() => {
          // ignore reconnect failures
        });
      }, 2000);
    };

    socket.onerror = () => {
      setRaceError("Connection error");
    };
  });
}

export function disconnectRaceWs(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket !== null) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
  setRaceWsConnected(false);
}

export function createParty(displayName: string): void {
  send({ type: "createParty", displayName });
}

export function joinParty(
  code: string,
  displayName: string,
  playerId?: string,
): void {
  send({
    type: "joinParty",
    code: code.toUpperCase(),
    displayName,
    playerId,
  });
}

export function startRace(): void {
  send({ type: "startRace" });
}

export function sendProgress(progress: number): void {
  send({ type: "progress", progress });
}

export function sendFinished(timeMs: number): void {
  setLocalFinished(true);
  send({ type: "finished", timeMs });
}

export function leaveParty(): void {
  send({ type: "leave" });
  clearRaceSession();
  setRaceParty(null);
  setRaceYou(null);
  setStandings([]);
  setLocalFinished(false);
  setCountdownSeconds(null);
}

export type { RacePartyState, RacePlayer };
