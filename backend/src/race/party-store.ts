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
  finishTimeout: ReturnType<typeof setTimeout> | null;
  countdownTimeout: ReturnType<typeof setTimeout> | null;
};

const parties = new Map<string, RaceParty>();
const playerToParty = new Map<string, string>();

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
    finishTimeout: null,
    countdownTimeout: null,
  };

  parties.set(code, party);
  playerToParty.set(hostId, code);
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

export function getPartyByPlayer(playerId: string): RaceParty | undefined {
  const code = playerToParty.get(playerId);
  if (code === undefined) return undefined;
  return parties.get(code);
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
  playerToParty.set(playerId, party.code);
  return player;
}

export function reconnectPlayer(
  party: RaceParty,
  playerId: string,
): RacePlayerInternal | undefined {
  const player = party.players.get(playerId);
  if (player === undefined) return undefined;
  player.connected = true;
  playerToParty.set(playerId, party.code);
  return player;
}

export function removePlayer(party: RaceParty, playerId: string): void {
  const player = party.players.get(playerId);
  if (player === undefined) return;

  if (party.status === "lobby") {
    party.players.delete(playerId);
    playerToParty.delete(playerId);
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
    playerToParty.delete(playerId);
  }
}

export function deleteParty(code: string): void {
  const party = parties.get(code);
  if (party === undefined) return;
  if (party.finishTimeout !== null) clearTimeout(party.finishTimeout);
  if (party.countdownTimeout !== null) clearTimeout(party.countdownTimeout);
  for (const id of party.players.keys()) {
    playerToParty.delete(id);
  }
  parties.delete(code);
}

export function playersList(party: RaceParty): RacePlayer[] {
  return [...party.players.values()].map(
    ({ lastProgressAt: _l, ...player }) => player,
  );
}

export function standings(party: RaceParty): RacePlayer[] {
  return playersList(party).sort((a, b) => {
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
