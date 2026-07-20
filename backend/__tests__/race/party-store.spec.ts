import { describe, expect, it } from "vitest";
import {
  RACE_MAX_PLAYERS,
  RACE_WORD_COUNT,
  RaceClientMessageSchema,
  RaceServerMessageSchema,
} from "@typeai/schemas/race";
import { generateRaceWordList } from "../../src/race/word-list";
import * as Store from "../../src/race/party-store";

describe("race word list", () => {
  it("generates exactly RACE_WORD_COUNT words by default", () => {
    const words = generateRaceWordList();
    expect(words).toHaveLength(RACE_WORD_COUNT);
    expect(words.every((w) => typeof w === "string" && w.length > 0)).toBe(
      true,
    );
  });

  it("avoids immediate consecutive duplicates when possible", () => {
    for (let i = 0; i < 20; i++) {
      const words = generateRaceWordList(50);
      for (let j = 1; j < words.length; j++) {
        expect(words[j]).not.toBe(words[j - 1]);
      }
    }
  });
});

describe("race party store", () => {
  it("creates a party with host and shared words", () => {
    const party = Store.createParty("host-1", "Alice");
    expect(party.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(party.status).toBe("lobby");
    expect(party.hostId).toBe("host-1");
    expect(party.words).toHaveLength(RACE_WORD_COUNT);
    expect(party.settings).toEqual({
      mode: "words",
      wordCount: 50,
      punctuation: false,
    });
    expect(party.players.size).toBe(1);
    expect(party.players.get("host-1")?.displayName).toBe("Alice");
    expect(party.players.get("host-1")?.isHost).toBe(true);
  });

  it("applies lobby settings for word count, punctuation, and quotes", () => {
    const party = Store.createParty("h", "Host", {
      mode: "words",
      wordCount: 25,
      punctuation: true,
    });
    expect(party.words).toHaveLength(25);
    expect(party.words.some((w) => /[.,!?;:]/.test(w))).toBe(true);

    Store.applySettings(party, {
      mode: "quote",
      wordCount: 50,
      punctuation: false,
    });
    expect(party.settings.mode).toBe("quote");
    expect(party.words.length).toBeGreaterThan(5);
  });

  it("joins players up to the max and rejects over capacity", () => {
    const party = Store.createParty("h", "Host");
    for (let i = 0; i < RACE_MAX_PLAYERS - 1; i++) {
      Store.addPlayer(party, `p${i}`, `Player${i}`);
    }
    expect(party.players.size).toBe(RACE_MAX_PLAYERS);
    expect(() => Store.addPlayer(party, "overflow", "Nope")).toThrow(/full/i);
  });

  it("rejects joins after the race has started", () => {
    const party = Store.createParty("h", "Host");
    Store.addPlayer(party, "g", "Guest");
    party.status = "racing";
    expect(() => Store.addPlayer(party, "late", "Late")).toThrow(
      /already started/i,
    );
  });

  it("marks players disconnected during a race instead of removing them", () => {
    const party = Store.createParty("h", "Host");
    Store.addPlayer(party, "g", "Guest");
    party.status = "racing";
    Store.removePlayer(party, "g");
    expect(party.players.has("g")).toBe(true);
    expect(party.players.get("g")?.connected).toBe(false);
  });

  it("removes lobby players and transfers host when host leaves", () => {
    const party = Store.createParty("h", "Host");
    Store.addPlayer(party, "g", "Guest");
    Store.removePlayer(party, "h");
    const updated = Store.getParty(party.code);
    expect(updated).toBeDefined();
    expect(updated?.hostId).toBe("g");
    expect(updated?.players.get("g")?.isHost).toBe(true);
    expect(updated?.players.has("h")).toBe(false);
  });

  it("reconnects a disconnected racer", () => {
    const party = Store.createParty("h", "Host");
    Store.addPlayer(party, "g", "Guest");
    party.status = "racing";
    Store.removePlayer(party, "g");
    const reconnected = Store.reconnectPlayer(party, "g");
    expect(reconnected?.connected).toBe(true);
  });

  it("ranks finished players by timeMs then progress", () => {
    const party = Store.createParty("h", "Host");
    Store.addPlayer(party, "fast", "Fast");
    Store.addPlayer(party, "slow", "Slow");
    const host = party.players.get("h");
    const fast = party.players.get("fast");
    const slow = party.players.get("slow");
    if (host === undefined || fast === undefined || slow === undefined) {
      throw new Error("expected players");
    }
    host.progress = 40;
    fast.timeMs = 12000;
    fast.progress = 100;
    slow.timeMs = 15000;
    slow.progress = 100;
    const ranking = Store.standings(party);
    expect(ranking.map((p) => p.id)).toEqual(["fast", "slow", "h"]);
  });

  it("treats disconnected unfinished players as done for completion", () => {
    const party = Store.createParty("h", "Host");
    Store.addPlayer(party, "g", "Guest");
    party.status = "racing";
    const host = party.players.get("h");
    if (host === undefined) throw new Error("expected host");
    host.timeMs = 10000;
    host.progress = 100;
    Store.removePlayer(party, "g");
    expect(Store.allFinishedOrDisconnected(party)).toBe(true);
    expect(Store.connectedUnfinishedCount(party)).toBe(0);
  });
});

describe("race protocol schemas", () => {
  it("accepts valid client messages", () => {
    expect(
      RaceClientMessageSchema.safeParse({
        type: "createParty",
        displayName: "Ada",
      }).success,
    ).toBe(true);
    expect(
      RaceClientMessageSchema.safeParse({
        type: "updateSettings",
        settings: { mode: "quote", wordCount: 50, punctuation: false },
      }).success,
    ).toBe(true);
    expect(
      RaceClientMessageSchema.safeParse({
        type: "startRace",
        settings: { mode: "words", wordCount: 100, punctuation: true },
      }).success,
    ).toBe(true);
    expect(
      RaceClientMessageSchema.safeParse({
        type: "progress",
        progress: 50,
      }).success,
    ).toBe(true);
    expect(
      RaceClientMessageSchema.safeParse({
        type: "finished",
        timeMs: 1234,
      }).success,
    ).toBe(true);
  });

  it("rejects invalid progress and empty names", () => {
    expect(
      RaceClientMessageSchema.safeParse({
        type: "progress",
        progress: 150,
      }).success,
    ).toBe(false);
    expect(
      RaceClientMessageSchema.safeParse({
        type: "createParty",
        displayName: "",
      }).success,
    ).toBe(false);
  });

  it("accepts raceComplete server payloads", () => {
    expect(
      RaceServerMessageSchema.safeParse({
        type: "raceComplete",
        winnerId: "p1",
        standings: [
          {
            id: "p1",
            displayName: "Ada",
            progress: 100,
            connected: true,
            isHost: true,
            timeMs: 9000,
          },
        ],
      }).success,
    ).toBe(true);
  });
});
