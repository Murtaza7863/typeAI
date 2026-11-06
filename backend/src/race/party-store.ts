import { randomBytes } from "crypto";
import {
  DEFAULT_RACE_SETTINGS,
  RACE_MAX_PLAYERS,
  RacePartyStatus,
  RacePlayer,
  RaceSettings,
} from "@typeai/schemas/race";
import { generateRaceText } from "./word-list";

export type RacePlayerInternal = RacePlayer & {
  lastProgressAt: number;
};

export type RaceParty = {
  code: string;
  hostId: string;
  status: RacePartyStatus;
  words: string[];
  settings: RaceSettings;
  players: Map<string, RacePlayerInternal>;
  createdAt: number;
  startedAt: number | null;
  countdownEndsAt: number | null;
  winnerId: string | null;
  hostOrigin: string | null;
  finishTimeout: ReturnType<typeof setTimeout> | null;
  countdownTimeout: ReturnType<typeof setTimeout> | null;
  idleTimeout: ReturnType<typeof setInterval> | null;
};

export type PartySnapshot = {
  code: string;
  hostId: string;
  status: RacePartyStatus;
  words: string[];
  settings: RaceSettings;
  players: RacePlayerInternal[];
  createdAt: number;
  startedAt: number | null;
  countdownEndsAt: number | null;
  winnerId: string | null;
  hostOrigin: string | null;
};

const parties = new Map<string, RaceParty>();
let partyDeleted: (code: string) => void = () => undefined;

export function setPartyDeletedHook(hook: (code: string) => void): void {
  partyDeleted = hook;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode(): string {
  let code = "";
  const bytes = randomBytes(6);
  for (let i = 0; i < 6; i++) {
    const byte = bytes[i] ?? 0;
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length] ?? "A";
  }
  return code;
}

export function createPartyCode(): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = makeCode();
    if (!parties.has(code)) return code;
  }
  throw new Error("Failed to allocate party code");
}

export function createParty(
  hostId: string,
  displayName: string,
  settings: RaceSettings = DEFAULT_RACE_SETTINGS,
): RaceParty {
  const code = createPartyCode();
  const host: RacePlayerInternal = {
    id: hostId,
    displayName: displayName.trim().slice(0, 24) || "Host",
    progress: 0,
    finishedAt: null,
    timeMs: null,
    connected: true,
    isHost: true,
    lastProgressAt: 0,
  };

  const party: RaceParty = {
    code,
    hostId,
    status: "lobby",
    settings: { ...settings },
    words: generateRaceText(settings),
    players: new Map([[hostId, host]]),
    createdAt: Date.now(),
    startedAt: null,
    countdownEndsAt: null,
    winnerId: null,
    hostOrigin: null,
    finishTimeout: null,
    countdownTimeout: null,
    idleTimeout: null,
  };

  parties.set(code, party);
  return party;
}

export function applySettings(party: RaceParty, settings: RaceSettings): void {
  if (party.status !== "lobby") {
    throw new Error("Can only change settings in the lobby");
  }
  party.settings = { ...settings };
  party.words = generateRaceText(party.settings);
}

export function getParty(code: string): RaceParty | undefined {
  return parties.get(code.toUpperCase());
}

export function addPlayer(
  party: RaceParty,
  playerId: string,
  displayName: string,
): RacePlayerInternal {
  if (party.status !== "lobby") {
    throw new Error("Race already started");
  }
  if (party.players.size >= RACE_MAX_PLAYERS) {
    throw new Error("Party is full (max 8 players)");
  }

  const player: RacePlayerInternal = {
    id: playerId,
    displayName: displayName.trim().slice(0, 24) || "Player",
    progress: 0,
    finishedAt: null,
    timeMs: null,
    connected: true,
    isHost: false,
    lastProgressAt: 0,
  };
  party.players.set(playerId, player);
  return player;
}

export function reconnectPlayer(
  party: RaceParty,
  playerId: string,
): RacePlayerInternal | undefined {
  const player = party.players.get(playerId);
  if (player === undefined) return undefined;
  player.connected = true;
  return player;
}

export function removePlayer(party: RaceParty, playerId: string): void {
  const player = party.players.get(playerId);
  if (player === undefined) return;

  if (party.status === "lobby") {
    party.players.delete(playerId);
    if (playerId === party.hostId) {
      const next = [...party.players.values()][0];
      if (next !== undefined) {
        party.hostId = next.id;
        next.isHost = true;
      } else {
        deleteParty(party.code);
        return;
      }
    }
  } else {
    player.connected = false;
  }
}

function clearTimers(party: RaceParty): void {
  if (party.finishTimeout !== null) clearTimeout(party.finishTimeout);
  if (party.countdownTimeout !== null) clearTimeout(party.countdownTimeout);
  if (party.idleTimeout !== null) clearInterval(party.idleTimeout);
  party.finishTimeout = null;
  party.countdownTimeout = null;
  party.idleTimeout = null;
}

export function deleteParty(code: string): void {
  const party = parties.get(code);
  if (party === undefined) return;
  clearTimers(party);
  parties.delete(code);
  partyDeleted(code);
}

export function resetPartyToLobby(party: RaceParty): void {
  clearTimers(party);
  for (const [id, player] of party.players) {
    if (!player.connected) {
      party.players.delete(id);
      continue;
    }
    player.progress = 0;
    player.finishedAt = null;
    player.timeMs = null;
    player.score = undefined;
    player.lastProgressAt = 0;
  }
  party.status = "lobby";
  party.startedAt = null;
  party.countdownEndsAt = null;
  party.winnerId = null;
  party.words = generateRaceText(party.settings);
}

export function playersList(party: RaceParty): RacePlayer[] {
  return [...party.players.values()].map(
    ({ lastProgressAt: _l, ...player }) => player,
  );
}

export function standings(party: RaceParty): RacePlayer[] {
  return playersList(party).sort((a, b) => {
    if (party.settings.mode === "time") {
      const aScore = a.score ?? a.progress;
      const bScore = b.score ?? b.progress;
      if (bScore !== aScore) return bScore - aScore;
      const aTime = a.timeMs ?? Number.POSITIVE_INFINITY;
      const bTime = b.timeMs ?? Number.POSITIVE_INFINITY;
      return aTime - bTime;
    }
    if (
      a.timeMs !== null &&
      a.timeMs !== undefined &&
      b.timeMs !== null &&
      b.timeMs !== undefined
    ) {
      return a.timeMs - b.timeMs;
    }
    if (a.timeMs !== null && a.timeMs !== undefined) return -1;
    if (b.timeMs !== null && b.timeMs !== undefined) return 1;
    return b.progress - a.progress;
  });
}

export function allFinishedOrDisconnected(party: RaceParty): boolean {
  for (const player of party.players.values()) {
    if (
      player.connected &&
      (player.timeMs === null || player.timeMs === undefined)
    ) {
      return false;
    }
  }
  return true;
}

export function stalledAfterFinish(
  party: RaceParty,
  now: number,
  idleMs: number,
): boolean {
  let someoneFinished = false;
  let unfinished = 0;
  for (const player of party.players.values()) {
    if (player.timeMs !== null && player.timeMs !== undefined) {
      someoneFinished = true;
      continue;
    }
    if (!player.connected) continue;
    unfinished += 1;
    const seen =
      player.lastProgressAt > 0
        ? player.lastProgressAt
        : (party.startedAt ?? now);
    if (now - seen < idleMs) return false;
  }
  return someoneFinished && unfinished > 0;
}

export function exportParty(party: RaceParty): PartySnapshot {
  return {
    code: party.code,
    hostId: party.hostId,
    status: party.status,
    words: [...party.words],
    settings: { ...party.settings },
    players: [...party.players.values()].map((player) => ({ ...player })),
    createdAt: party.createdAt,
    startedAt: party.startedAt,
    countdownEndsAt: party.countdownEndsAt,
    winnerId: party.winnerId,
    hostOrigin: party.hostOrigin,
  };
}

export function importParty(snapshot: PartySnapshot): RaceParty | undefined {
  if (parties.has(snapshot.code)) return parties.get(snapshot.code);
  const players = new Map<string, RacePlayerInternal>();
  for (const player of snapshot.players) {
    players.set(player.id, { ...player });
  }
  if (players.size === 0) return undefined;
  const party: RaceParty = {
    code: snapshot.code,
    hostId: snapshot.hostId,
    status: snapshot.status,
    words: [...snapshot.words],
    settings: { ...snapshot.settings },
    players,
    createdAt: snapshot.createdAt,
    startedAt: snapshot.startedAt,
    countdownEndsAt: snapshot.countdownEndsAt,
    winnerId: snapshot.winnerId,
    hostOrigin: snapshot.hostOrigin,
    finishTimeout: null,
    countdownTimeout: null,
    idleTimeout: null,
  };
  parties.set(party.code, party);
  return party;
}

export function connectedUnfinishedCount(party: RaceParty): number {
  let count = 0;
  for (const player of party.players.values()) {
    if (
      player.connected &&
      (player.timeMs === null || player.timeMs === undefined)
    ) {
      count++;
    }
  }
  return count;
}
