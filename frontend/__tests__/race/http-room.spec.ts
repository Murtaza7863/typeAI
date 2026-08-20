import { describe, expect, it, beforeEach } from "vitest";
import {
  handleRaceRoomRequest,
  resetRaceRoomsForTests,
  setRaceDurableStoreForTests,
  type DurableStore,
} from "../../../api/race-room";

function memoryRemoteStore(): DurableStore {
  const data = new Map<string, string>();
  return {
    name: "test-remote",
    async get(code) {
      const raw = data.get(code);
      if (raw === undefined) return undefined;
      return JSON.parse(raw) as Awaited<ReturnType<DurableStore["get"]>>;
    },
    async set(party) {
      data.set(party.code, JSON.stringify(party));
    },
    async delete(code) {
      data.delete(code);
    },
  };
}

async function post(body: Record<string, unknown>): Promise<{
  ok?: boolean;
  playerId?: string;
  messages: { type: string; [k: string]: unknown }[];
}> {
  const response = await handleRaceRoomRequest(
    new Request("https://typeaiapp.vercel.app/api/race-room", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "typeaiapp.vercel.app",
      },
      body: JSON.stringify(body),
    }),
  );
  return (await response.json()) as {
    ok?: boolean;
    playerId?: string;
    messages: { type: string; [k: string]: unknown }[];
  };
}

function partyFrom(messages: { type: string; [k: string]: unknown }[]): {
  code: string;
  status: string;
  players: { id: string; displayName: string }[];
  words: string[];
} {
  const state = messages.find((m) => m.type === "partyState") as
    | {
        party: {
          code: string;
          status: string;
          players: { id: string; displayName: string }[];
          words: string[];
        };
      }
    | undefined;
  if (state === undefined) throw new Error("missing partyState");
  return state.party;
}

describe("HTTP race room — two players", () => {
  beforeEach(() => {
    resetRaceRoomsForTests();
    setRaceDurableStoreForTests(null);
  });

  it("lets a friend join the host party and both finish a race", async () => {
    const created = await post({
      type: "createParty",
      displayName: "Murtaza",
      settings: { mode: "words", wordCount: 25, punctuation: false },
    });
    expect(created.ok).toBe(true);
    const hostId = created.playerId;
    expect(hostId).toBeTypeOf("string");
    const hostParty = partyFrom(created.messages);
    expect(hostParty.players).toHaveLength(1);
    expect(hostParty.players[0]?.displayName).toBe("Murtaza");

    const joined = await post({
      type: "joinParty",
      code: hostParty.code,
      displayName: "Friend",
    });
    expect(joined.ok).toBe(true);
    const friendId = joined.playerId;
    expect(friendId).toBeTypeOf("string");
    expect(friendId).not.toBe(hostId);
    const lobby = partyFrom(joined.messages);
    expect(lobby.players.map((p) => p.displayName).sort()).toEqual([
      "Friend",
      "Murtaza",
    ]);

    const started = await post({
      type: "startRace",
      code: hostParty.code,
      playerId: hostId,
    });
    expect(started.messages.some((m) => m.type === "countdown")).toBe(true);
    expect(partyFrom(started.messages).status).toBe("countdown");

    const guestPoll = await post({
      type: "poll",
      code: hostParty.code,
      playerId: friendId,
    });
    expect(guestPoll.messages.some((m) => m.type === "countdown")).toBe(true);

    const originalNow = Date.now;
    Date.now = () => originalNow() + 4000;
    try {
      const racing = await post({
        type: "poll",
        code: hostParty.code,
        playerId: hostId,
      });
      expect(partyFrom(racing.messages).status).toBe("racing");
      expect(racing.messages.some((m) => m.type === "raceStart")).toBe(true);
      const words = partyFrom(racing.messages).words;
      expect(words.length).toBe(25);

      await post({
        type: "progress",
        code: hostParty.code,
        playerId: friendId,
        progress: 40,
      });
      const mid = await post({
        type: "poll",
        code: hostParty.code,
        playerId: hostId,
      });
      const friend = partyFrom(mid.messages).players.find(
        (p) => p.displayName === "Friend",
      ) as { progress?: number };
      expect(friend.progress).toBe(40);

      await post({
        type: "finished",
        code: hostParty.code,
        playerId: hostId,
        timeMs: 8000,
      });
      const done = await post({
        type: "finished",
        code: hostParty.code,
        playerId: friendId,
        timeMs: 9000,
      });
      expect(partyFrom(done.messages).status).toBe("finished");
      expect(done.messages.some((m) => m.type === "raceComplete")).toBe(true);
    } finally {
      Date.now = originalNow;
    }
  });

  it("rejects joining a missing party", async () => {
    const missing = await post({
      type: "joinParty",
      code: "NOPE12",
      displayName: "Friend",
    });
    expect(missing.ok).toBe(false);
    expect(missing.messages[0]?.type).toBe("error");
  });

  it("lets a friend join after the host's instance loses memory", async () => {
    const remote = memoryRemoteStore();
    setRaceDurableStoreForTests(remote);

    const created = await post({
      type: "createParty",
      displayName: "Host",
      settings: { mode: "words", wordCount: 25, punctuation: false },
    });
    expect(created.ok).toBe(true);
    const hostParty = partyFrom(created.messages);

    resetRaceRoomsForTests();

    const joined = await post({
      type: "joinParty",
      code: hostParty.code,
      displayName: "Friend",
    });
    expect(joined.ok).toBe(true);
    expect(
      partyFrom(joined.messages)
        .players.map((p) => p.displayName)
        .sort(),
    ).toEqual(["Friend", "Host"]);

    resetRaceRoomsForTests();
    const hostPoll = await post({
      type: "poll",
      code: hostParty.code,
      playerId: created.playerId,
    });
    expect(hostPoll.ok).toBe(true);
    expect(
      partyFrom(hostPoll.messages)
        .players.map((p) => p.displayName)
        .sort(),
    ).toEqual(["Friend", "Host"]);
  });
});
