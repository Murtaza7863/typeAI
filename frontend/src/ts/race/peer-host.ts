import {
  DEFAULT_RACE_SETTINGS,
  RACE_COUNTDOWN_SECONDS,
  RACE_FINISH_TIMEOUT_MS,
  RACE_MAX_PLAYERS,
  RaceClientMessage,
  RacePartyState,
  RacePlayer,
  RaceServerMessage,
  RaceSettings,
} from "@typeai/schemas/race";
import type { DataConnection, Peer } from "peerjs";

import { generateRaceText } from "./word-list";

type PlayerInternal = RacePlayer & {
  connection: DataConnection | null;
  lastProgressAt: number;
};

type PartyInternal = {
  code: string;
  hostId: string;
  status: RacePartyState["status"];
  words: string[];
  settings: RaceSettings;
  players: Map<string, PlayerInternal>;
  startedAt: number | null;
  countdownEndsAt: number | null;
  winnerId: string | null;
  finishTimeout: ReturnType<typeof setTimeout> | null;
  countdownTimeout: ReturnType<typeof setTimeout> | null;
};

function publicPlayer(player: PlayerInternal): RacePlayer {
  const { connection: _c, lastProgressAt: _l, ...rest } = player;
  return rest;
}

function playersList(party: PartyInternal): RacePlayer[] {
  return [...party.players.values()].map(publicPlayer);
}

function standings(party: PartyInternal): RacePlayer[] {
  return playersList(party).sort((a, b) => {
    if (party.settings.mode === "time") {
      if (b.progress !== a.progress) return b.progress - a.progress;
      if (typeof a.timeMs === "number" && typeof b.timeMs === "number") {
        return a.timeMs - b.timeMs;
      }
      if (typeof a.timeMs === "number") return -1;
      if (typeof b.timeMs === "number") return 1;
      return 0;
    }
    const aTime = typeof a.timeMs === "number";
    const bTime = typeof b.timeMs === "number";
    if (aTime && bTime) return (a.timeMs as number) - (b.timeMs as number);
    if (aTime) return -1;
    if (bTime) return 1;
    return b.progress - a.progress;
  });
}

export type PeerHostCallbacks = {
  onMessage: (playerId: string, message: RaceServerMessage) => void;
  sendTo: (connection: DataConnection, message: RaceServerMessage) => void;
};

export class PeerRaceHost {
  private party: PartyInternal | null = null;
  private readonly peer: Peer;
  private readonly callbacks: PeerHostCallbacks;

  constructor(peer: Peer, callbacks: PeerHostCallbacks) {
    this.peer = peer;
    this.callbacks = callbacks;
    this.peer.on("connection", (conn) => {
      // Attach immediately — guests often send joinParty as soon as *their*
      // data channel opens, which can be before this side's "open" event.
      conn.on("data", (data) => {
        this.handleRaw(conn, data);
      });
      conn.on("close", () => {
        this.onConnectionClosed(conn);
      });
      conn.on("error", () => {
        this.onConnectionClosed(conn);
      });
    });
  }

  getPartyCode(): string | null {
    return this.party?.code ?? null;
  }

  createParty(
    displayName: string,
    settings: RaceSettings = DEFAULT_RACE_SETTINGS,
  ): string {
    const code = this.peer.id.toUpperCase();
    const hostId = this.peer.id;
    const host: PlayerInternal = {
      id: hostId,
      displayName: displayName.trim().slice(0, 24) || "Host",
      progress: 0,
      finishedAt: null,
      timeMs: null,
      connected: true,
      isHost: true,
      connection: null,
      lastProgressAt: 0,
    };
    this.party = {
      code,
      hostId,
      status: "lobby",
      settings: { ...settings },
      words: generateRaceText(settings),
      players: new Map([[hostId, host]]),
      startedAt: null,
      countdownEndsAt: null,
      winnerId: null,
      finishTimeout: null,
      countdownTimeout: null,
    };
    this.emitToPlayer(hostId, this.partyStateFor(hostId));
    return code;
  }

  handleLocalMessage(message: RaceClientMessage): void {
    this.dispatch(null, message);
  }

  destroy(): void {
    if (this.party?.countdownTimeout !== null && this.party !== null) {
      clearTimeout(this.party.countdownTimeout);
    }
    if (this.party?.finishTimeout !== null && this.party !== null) {
      clearTimeout(this.party.finishTimeout);
    }
    this.party = null;
  }

  private handleRaw(conn: DataConnection, data: unknown): void {
    let parsed: unknown = data;
    if (typeof data === "string") {
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("type" in parsed) ||
      typeof (parsed as { type: unknown }).type !== "string"
    ) {
      return;
    }
    this.dispatch(conn, parsed as RaceClientMessage);
  }

  private dispatch(
    conn: DataConnection | null,
    message: RaceClientMessage,
  ): void {
    switch (message.type) {
      case "joinParty":
        this.handleJoin(conn, message.displayName, message.playerId);
        break;
      case "updateSettings":
        this.handleUpdateSettings(message.settings);
        break;
      case "startRace":
        this.handleStart(message.settings);
        break;
      case "progress":
        this.handleProgress(conn, message.progress);
        break;
      case "finished":
        this.handleFinished(conn, message.timeMs);
        break;
      case "leave":
        this.handleLeave(conn);
        break;
      case "reconnect":
        this.handleJoin(conn, "Player", message.playerId);
        break;
      default:
        break;
    }
  }

  private handleUpdateSettings(settings: RaceSettings): void {
    if (this.party === null || this.party.status !== "lobby") return;
    this.party.settings = { ...settings };
    this.party.words = generateRaceText(this.party.settings);
    this.broadcastPartyState();
  }

  private handleJoin(
    conn: DataConnection | null,
    displayName: string,
    existingPlayerId?: string,
  ): void {
    if (this.party === null) {
      if (conn !== null) {
        this.callbacks.sendTo(conn, {
          type: "error",
          message: "Party not found",
        });
      }
      return;
    }

    if (conn !== null) {
      const alreadyJoined = this.playerFromConn(conn);
      if (alreadyJoined !== undefined) {
        alreadyJoined.connected = true;
        alreadyJoined.connection = conn;
        this.emitToPlayer(
          alreadyJoined.id,
          this.partyStateFor(alreadyJoined.id),
        );
        return;
      }
    }
    if (this.party.status !== "lobby" && existingPlayerId === undefined) {
      if (conn !== null) {
        this.callbacks.sendTo(conn, {
          type: "error",
          message: "Race already started",
        });
      }
      return;
    }

    if (existingPlayerId !== undefined) {
      const existing = this.party.players.get(existingPlayerId);
      if (existing !== undefined) {
        existing.connected = true;
        existing.connection = conn;
        this.broadcastPartyState();
        return;
      }
    }

    if (this.party.players.size >= RACE_MAX_PLAYERS) {
      if (conn !== null) {
        this.callbacks.sendTo(conn, {
          type: "error",
          message: "Party is full (max 8 players)",
        });
      }
      return;
    }

    const playerId = crypto.randomUUID();
    const player: PlayerInternal = {
      id: playerId,
      displayName: displayName.trim().slice(0, 24) || "Player",
      progress: 0,
      finishedAt: null,
      timeMs: null,
      connected: true,
      isHost: false,
      connection: conn,
      lastProgressAt: 0,
    };
    this.party.players.set(playerId, player);
    this.broadcastPartyState();
  }

  private handleStart(settings?: RaceSettings): void {
    if (this.party === null || this.party.status !== "lobby") return;
    if (this.party.players.size < 2) {
      this.emitToPlayer(this.party.hostId, {
        type: "error",
        message: "Need at least 2 players to start",
      });
      return;
    }

    if (settings !== undefined) {
      this.party.settings = { ...settings };
    }
    this.party.words = generateRaceText(this.party.settings);

    this.party.status = "countdown";
    const endsAt = Date.now() + RACE_COUNTDOWN_SECONDS * 1000;
    this.party.countdownEndsAt = endsAt;
    this.broadcast({
      type: "countdown",
      endsAt,
      seconds: RACE_COUNTDOWN_SECONDS,
    });
    this.broadcastPartyState();

    this.party.countdownTimeout = setTimeout(() => {
      if (this.party === null || this.party.status !== "countdown") return;
      this.party.countdownTimeout = null;
      this.party.status = "racing";
      this.party.startedAt = Date.now();
      this.party.countdownEndsAt = null;
      for (const player of this.party.players.values()) {
        player.progress = 0;
        player.finishedAt = null;
        player.timeMs = null;
      }
      this.broadcast({
        type: "raceStart",
        startedAt: this.party.startedAt,
        words: this.party.words,
        settings: this.party.settings,
      });
      this.broadcastPartyState();
    }, RACE_COUNTDOWN_SECONDS * 1000);
  }

  private playerFromConn(
    conn: DataConnection | null,
  ): PlayerInternal | undefined {
    if (this.party === null) return undefined;
    if (conn === null) {
      return this.party.players.get(this.party.hostId);
    }
    for (const player of this.party.players.values()) {
      if (player.connection === conn) return player;
    }
    return undefined;
  }

  private handleProgress(conn: DataConnection | null, progress: number): void {
    if (this.party === null || this.party.status !== "racing") return;
    const player = this.playerFromConn(conn);
    if (player === undefined || typeof player.timeMs === "number") return;

    const now = Date.now();
    if (now - player.lastProgressAt < 100) return;
    player.lastProgressAt = now;

    const clamped = Math.max(0, Math.min(100, Math.floor(progress)));
    if (clamped === player.progress) return;
    player.progress = clamped;
    this.broadcast({
      type: "progressUpdate",
      playerId: player.id,
      progress: clamped,
    });
  }

  private handleFinished(conn: DataConnection | null, timeMs: number): void {
    if (this.party === null || this.party.status !== "racing") return;
    const player = this.playerFromConn(conn);
    if (player === undefined || typeof player.timeMs === "number") return;

    if (this.party.settings.mode !== "time") {
      player.progress = 100;
      this.party.winnerId ??= player.id;
    }
    if (this.party.settings.mode === "time" && this.party.startedAt !== null) {
      player.timeMs = Math.max(1, Date.now() - this.party.startedAt);
    } else {
      player.timeMs = Math.max(1, Math.floor(timeMs));
    }
    player.finishedAt = Date.now();

    const ranking = standings(this.party);
    const place =
      ranking.findIndex((p) => p.id === player.id) + 1 || ranking.length;
    this.broadcast({
      type: "playerFinished",
      playerId: player.id,
      timeMs,
      place,
      standings: ranking,
    });
    this.broadcastPartyState();

    if (this.connectedUnfinished() === 0) {
      this.completeRace();
      return;
    }

    this.party.finishTimeout ??= setTimeout(() => {
      if (this.party === null) return;
      this.party.finishTimeout = null;
      if (this.party.status === "racing") this.completeRace();
    }, RACE_FINISH_TIMEOUT_MS);
  }

  private handleLeave(conn: DataConnection | null): void {
    if (this.party === null) return;
    const player = this.playerFromConn(conn);
    if (player === undefined) return;

    if (this.party.status === "lobby") {
      this.party.players.delete(player.id);
      if (player.id === this.party.hostId) {
        this.party = null;
        return;
      }
    } else {
      player.connected = false;
      player.connection = null;
    }
    this.broadcastPartyState();
    if (this.party !== null && this.connectedUnfinished() === 0) {
      this.completeRace();
    }
  }

  private onConnectionClosed(conn: DataConnection): void {
    this.handleLeave(conn);
  }

  private connectedUnfinished(): number {
    if (this.party === null) return 0;
    let count = 0;
    for (const player of this.party.players.values()) {
      if (player.connected && typeof player.timeMs !== "number") count++;
    }
    return count;
  }

  private completeRace(): void {
    if (this.party === null || this.party.status === "finished") return;
    this.party.status = "finished";
    if (this.party.finishTimeout !== null) {
      clearTimeout(this.party.finishTimeout);
      this.party.finishTimeout = null;
    }
    const ranking = standings(this.party);
    if (this.party.settings.mode === "time") {
      this.party.winnerId = ranking[0]?.id ?? null;
    } else if (this.party.winnerId === null) {
      const winner = ranking.find((p) => typeof p.timeMs === "number");
      this.party.winnerId = winner?.id ?? null;
    }
    this.broadcast({
      type: "raceComplete",
      winnerId: this.party.winnerId,
      standings: ranking,
    });
    this.broadcastPartyState();
  }

  private partyStateFor(playerId: string): RaceServerMessage {
    const party = this.party;
    if (party === null) {
      return { type: "error", message: "Party not found" };
    }
    const you = party.players.get(playerId);
    if (you === undefined) {
      return { type: "error", message: "Player not found" };
    }
    return {
      type: "partyState",
      party: {
        code: party.code,
        status: party.status,
        hostId: party.hostId,
        words: party.words,
        settings: party.settings,
        players: playersList(party),
        inviteUrl: `${window.location.origin}/race/${party.code}`,
        startedAt: party.startedAt,
        countdownEndsAt: party.countdownEndsAt,
        winnerId: party.winnerId,
      },
      you: publicPlayer(you),
    };
  }

  private emitToPlayer(playerId: string, message: RaceServerMessage): void {
    if (this.party === null) return;
    const player = this.party.players.get(playerId);
    if (player === undefined) return;
    this.callbacks.onMessage(playerId, message);
    if (player.connection !== null && player.connection.open) {
      this.callbacks.sendTo(player.connection, message);
    }
  }

  private broadcast(message: RaceServerMessage): void {
    if (this.party === null) return;
    for (const player of this.party.players.values()) {
      this.callbacks.onMessage(player.id, message);
      if (player.connection !== null && player.connection.open) {
        this.callbacks.sendTo(player.connection, message);
      }
    }
  }

  private broadcastPartyState(): void {
    if (this.party === null) return;
    for (const player of this.party.players.values()) {
      this.emitToPlayer(player.id, this.partyStateFor(player.id));
    }
  }
}
