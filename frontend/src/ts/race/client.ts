import {
  DEFAULT_RACE_SETTINGS,
  RaceClientMessage,
  RacePartyState,
  RacePlayer,
  RaceServerMessage,
  RaceServerMessageSchema,
  RaceSettings,
} from "@typeai/schemas/race";
import { Peer, type DataConnection } from "peerjs";
import { envConfig } from "virtual:env-config";

import {
  clearRaceSession,
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
import { PeerRaceHost } from "./peer-host";

type MessageHandler = (message: RaceServerMessage) => void;
type TransportMode = "none" | "ws" | "peer";

let socket: WebSocket | null = null;
let handlers: MessageHandler[] = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let mode: TransportMode = "none";
let peer: Peer | null = null;
let peerHost: PeerRaceHost | null = null;
let guestConnection: DataConnection | null = null;
let localPlayerId: string | null = null;
let connectPromise: Promise<void> | null = null;

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

function publicApiWithoutRaceWs(): boolean {
  const url = envConfig.backendUrl;
  return url.includes("api.typeai.com") || url.includes("api.monkeytype.com");
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

function handleServerMessage(raw: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  const result = RaceServerMessageSchema.safeParse(parsed);
  if (!result.success) return;
  applyServerMessage(result.data);
}

function sendJson(
  connection: DataConnection,
  message: RaceServerMessage,
): void {
  void connection.send(message);
}

async function tryWebSocket(timeoutMs: number): Promise<boolean> {
  if (publicApiWithoutRaceWs()) return false;

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      resolve(false);
      return;
    }

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.onopen = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.close();
      resolve(false);
    }, timeoutMs);

    ws.onopen = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket = ws;
      mode = "ws";
      setRaceWsConnected(true);
      setRaceError(null);

      ws.onmessage = (event) => {
        handleServerMessage(String(event.data));
      };
      ws.onclose = () => {
        setRaceWsConnected(false);
        socket = null;
        if (mode === "ws") {
          mode = "none";
          if (reconnectTimer !== null) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            void connectRaceWs().catch(() => {
              // ignore
            });
          }, 2000);
        }
      };

      const session = getRaceSession();
      if (session !== null) {
        ws.send(
          JSON.stringify({
            type: "reconnect",
            code: session.code,
            playerId: session.playerId,
          } satisfies RaceClientMessage),
        );
      }
      resolve(true);
    };

    ws.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.onopen = null;
      ws.onclose = null;
      try {
        ws.close();
      } catch {
        // ignore
      }
      resolve(false);
    };
  });
}

function ensurePeerModeReady(): void {
  mode = "peer";
  setRaceWsConnected(true);
  setRaceError(null);
}

function destroyPeer(): void {
  peerHost?.destroy();
  peerHost = null;
  if (guestConnection !== null) {
    guestConnection.close();
    guestConnection = null;
  }
  if (peer !== null) {
    peer.destroy();
    peer = null;
  }
}

const PEER_OPTIONS = {
  debug: 0,
  config: {
    iceCandidatePoolSize: 10,
    sdpSemantics: "unified-plan",
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun.cloudflare.com:3478" },
      {
        urls: [
          "turn:eu-0.turn.peerjs.com:3478",
          "turn:us-0.turn.peerjs.com:3478",
        ],
        username: "peerjs",
        credential: "peerjsp",
      },
    ],
  },
} as const;

function peerErrorMessage(err: unknown): string {
  if (err !== null && typeof err === "object" && "type" in err) {
    const type = String((err as { type: unknown }).type);
    if (type === "peer-unavailable") {
      return "Host not found — ask them to keep the race page open and share a fresh invite.";
    }
    if (type === "unavailable-id") {
      return "That party code is already in use. Create a new party.";
    }
    if (type === "network" || type === "socket-error") {
      return "Could not reach the race broker. Check your network and try again.";
    }
    if (type === "webrtc") {
      return "Could not open a peer link (firewall/NAT). Try a different network, or both join from the same Wi‑Fi.";
    }
  }
  if (err instanceof Error && err.message.length > 0) return err.message;
  return "Peer error";
}

async function createPeerWithId(id?: string): Promise<Peer> {
  return await new Promise((resolve, reject) => {
    const instance =
      id !== undefined && id.length > 0
        ? new Peer(id, PEER_OPTIONS)
        : new Peer(PEER_OPTIONS);
    const timer = setTimeout(() => {
      instance.destroy();
      reject(new Error("Peer connection timed out"));
    }, 15000);

    instance.on("open", () => {
      clearTimeout(timer);
      resolve(instance);
    });
    instance.on("error", (err) => {
      clearTimeout(timer);
      instance.destroy();
      reject(new Error(peerErrorMessage(err)));
    });
  });
}

async function hostCreateParty(
  displayName: string,
  settings: RaceSettings = DEFAULT_RACE_SETTINGS,
): Promise<void> {
  destroyPeer();
  let code = "";
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt++) {
    code = "";
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (let i = 0; i < 6; i++) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)] ?? "A";
    }
    try {
      peer = await createPeerWithId(code.toLowerCase());
      lastError = null;
      break;
    } catch (e) {
      lastError = e;
      peer = null;
    }
  }
  if (peer === null) {
    setRaceError(
      lastError instanceof Error
        ? lastError.message
        : "Could not create race room",
    );
    return;
  }

  localPlayerId = peer.id;
  peerHost = new PeerRaceHost(peer, {
    onMessage: (playerId, message) => {
      if (playerId === localPlayerId) {
        applyServerMessage(message);
      }
    },
    sendTo: sendJson,
  });
  peerHost.createParty(displayName, settings);
}

async function guestJoinParty(
  code: string,
  displayName: string,
  playerId?: string,
): Promise<void> {
  destroyPeer();
  peer = await createPeerWithId();
  const hostId = code.toLowerCase();
  const joinMessage = {
    type: "joinParty",
    code: code.toUpperCase(),
    displayName,
    playerId,
  } satisfies RaceClientMessage;

  await new Promise<void>((resolve, reject) => {
    if (peer === null) {
      reject(new Error("Peer not ready"));
      return;
    }

    const guestPeer = peer;
    let settled = false;
    const retryTimers: ReturnType<typeof setTimeout>[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      for (const retry of retryTimers) clearTimeout(retry);
    };

    const fail = (message: string): void => {
      cleanup();
      reject(new Error(message));
    };

    const onPeerError = (err: unknown): void => {
      if (settled) return;
      fail(peerErrorMessage(err));
    };
    guestPeer.on("error", onPeerError);

    const conn = guestPeer.connect(hostId, {
      reliable: true,
      serialization: "json",
    });
    guestConnection = conn;

    timer = setTimeout(() => {
      fail(
        "Could not reach host — they must keep the race tab open, and you both need https://typeaiapp.vercel.app/",
      );
    }, 20000);

    const sendJoin = (): void => {
      if (settled || !conn.open) return;
      void conn.send(joinMessage);
    };

    conn.on("open", () => {
      sendJoin();
      retryTimers.push(setTimeout(sendJoin, 200));
      retryTimers.push(setTimeout(sendJoin, 800));
    });
    conn.on("data", (data) => {
      let parsed: unknown = data;
      if (typeof data === "string") {
        try {
          parsed = JSON.parse(data);
        } catch {
          return;
        }
      }
      const result = RaceServerMessageSchema.safeParse(parsed);
      if (!result.success) return;
      applyServerMessage(result.data);
      if (result.data.type === "error") {
        fail(result.data.message);
        return;
      }
      if (result.data.type === "partyState") {
        cleanup();
        resolve();
      }
    });
    conn.on("close", () => {
      setRaceWsConnected(false);
      if (!settled) fail("Host closed the connection");
    });
    conn.on("error", () => {
      fail("Failed to connect to host");
    });
  });
}

/**
 * Ready the race transport (WebSocket if available, otherwise browser P2P).
 */
export async function connectRaceWs(): Promise<void> {
  if (
    mode === "ws" &&
    socket !== null &&
    socket.readyState === WebSocket.OPEN
  ) {
    return;
  }
  if (mode === "peer") {
    ensurePeerModeReady();
    return;
  }
  if (connectPromise !== null) return connectPromise;

  connectPromise = (async () => {
    const wsOk = await tryWebSocket(2500);
    if (wsOk) return;
    ensurePeerModeReady();
  })().finally(() => {
    connectPromise = null;
  });

  await connectPromise;
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
  destroyPeer();
  mode = "none";
  setRaceWsConnected(false);
}

function send(message: RaceClientMessage): void {
  if (mode === "ws") {
    if (socket === null || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(message));
    return;
  }
  if (mode === "peer") {
    if (peerHost !== null) {
      peerHost.handleLocalMessage(message);
      return;
    }
    if (guestConnection !== null && guestConnection.open) {
      void guestConnection.send(message);
    }
  }
}

export async function createParty(
  displayName: string,
  settings: RaceSettings = DEFAULT_RACE_SETTINGS,
): Promise<void> {
  if (mode === "peer") {
    try {
      await hostCreateParty(displayName, settings);
    } catch (e: unknown) {
      setRaceError(e instanceof Error ? e.message : "Failed to create party");
    }
    return;
  }
  send({ type: "createParty", displayName, settings });
}

export async function joinParty(
  code: string,
  displayName: string,
  playerId?: string,
): Promise<void> {
  if (mode === "peer") {
    try {
      await guestJoinParty(code, displayName, playerId);
    } catch (e: unknown) {
      setRaceError(e instanceof Error ? e.message : "Failed to join party");
    }
    return;
  }
  send({
    type: "joinParty",
    code: code.toUpperCase(),
    displayName,
    playerId,
  });
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
  send({ type: "leave" });
  clearRaceSession();
  setRaceParty(null);
  setRaceYou(null);
  setStandings([]);
  setLocalFinished(false);
  setCountdownSeconds(null);
  setIsRaceActive(false);
  setRaceStartedAt(null);
  if (mode === "peer") {
    destroyPeer();
    ensurePeerModeReady();
  }
  localPlayerId = null;
}

export type { RacePartyState, RacePlayer };
