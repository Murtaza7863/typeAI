import { describe, expect, it, beforeEach } from "vitest";
import {
  handleRaceRoomRequest,
  resetRaceRoomsForTests,
  setRaceDurableStoreForTests,
  type DurableStore,
} from "../../../api/race-room";

type StoredParty = Awaited<ReturnType<DurableStore["get"]>>;

function createRemoteStore(opts?: { staleGets?: boolean }): DurableStore & {
  peek: (code: string) => StoredParty | undefined;
  bust: () => void;
} {
  const data = new Map<string, string>();
  const getCache = new Map<string, string>();
  return {
    name: opts?.staleGets === true ? "stale-remote" : "test-remote",
    bust: () => {
      getCache.clear();
    },
    peek(code) {
      const raw = data.get(code);
      if (raw === undefined) return undefined;
      return JSON.parse(raw) as StoredParty;
    },
    async get(code) {
      if (opts?.staleGets === true) {
        const cached = getCache.get(code);
        if (cached !== undefined) return JSON.parse(cached) as StoredParty;
      }
      const raw = data.get(code);
      if (raw === undefined) return undefined;
      if (opts?.staleGets === true) getCache.set(code, raw);
      return JSON.parse(raw) as StoredParty;
    },
    async set(party) {
      data.set(party.code, JSON.stringify(party));
      if (opts?.staleGets !== true) getCache.delete(party.code);
    },
    async delete(code) {
      data.delete(code);
      getCache.delete(code);
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

async function getHealth(): Promise<{
  ok?: boolean;
  service?: string;
  store?: string;
}> {
  const response = await handleRaceRoomRequest(
    new Request("https://typeaiapp.vercel.app/api/race-room", {
      method: "GET",
    }),
  );
  return (await response.json()) as {
    ok?: boolean;
    service?: string;
    store?: string;
  };
}

function partyFrom(messages: { type: string; [k: string]: unknown }[]): {
  code: string;
  status: string;
  hostId: string;
  players: {
    id: string;
    displayName: string;
    progress?: number;
    isHost?: boolean;
    connected?: boolean;
    timeMs?: number | null;
  }[];
  words: string[];
  settings?: { mode?: string; wordCount?: number; punctuation?: boolean };
  inviteUrl?: string;
  winnerId?: string | null;
} {
  const state = messages.find((m) => m.type === "partyState") as
    | {
        party: {
          code: string;
          status: string;
          hostId: string;
          players: {
            id: string;
            displayName: string;
            progress?: number;
            isHost?: boolean;
            connected?: boolean;
            timeMs?: number | null;
          }[];
          words: string[];
          settings?: {
            mode?: string;
            wordCount?: number;
            punctuation?: boolean;
          };
          inviteUrl?: string;
          winnerId?: string | null;
        };
      }
    | undefined;
  if (state === undefined) throw new Error("missing partyState");
  return state.party;
}

function names(messages: { type: string; [k: string]: unknown }[]): string[] {
  return partyFrom(messages)
    .players.map((p) => p.displayName)
    .sort();
}

function errorMessage(
  messages: { type: string; [k: string]: unknown }[],
): string {
  const err = messages.find((m) => m.type === "error") as
    | { message?: string }
    | undefined;
  return err?.message ?? "";
}

async function createHost(
  displayName = "Host",
  settings: Record<string, unknown> = {
    mode: "words",
    wordCount: 25,
    punctuation: false,
  },
): Promise<{ code: string; hostId: string; words: string[] }> {
  const created = await post({
    type: "createParty",
    displayName,
    settings,
  });
  expect(created.ok).toBe(true);
  const party = partyFrom(created.messages);
  expect(created.playerId).toBeTypeOf("string");
  return {
    code: party.code,
    hostId: created.playerId as string,
    words: party.words,
  };
}

describe("HTTP race room", () => {
  beforeEach(() => {
    resetRaceRoomsForTests();
    setRaceDurableStoreForTests(null);
  });

  it("reports the race-room health endpoint", async () => {
    const health = await getHealth();
    expect(health.ok).toBe(true);
    expect(health.service).toBe("race-room");
    expect(health.store).toBe("memory");
  });

  it("creates a lobby with a 6-character code and invite link", async () => {
    const created = await post({
      type: "createParty",
      displayName: "Murtaza",
      settings: { mode: "words", wordCount: 50, punctuation: false },
    });
    const party = partyFrom(created.messages);
    expect(party.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(party.status).toBe("lobby");
    expect(party.players).toHaveLength(1);
    expect(party.players[0]?.isHost).toBe(true);
    expect(party.words).toHaveLength(50);
    expect(party.inviteUrl).toContain(`/race/${party.code}`);
    expect(party.settings?.wordCount).toBe(50);
  });

  it("rejects starting with only the host", async () => {
    const { code, hostId } = await createHost();
    const started = await post({
      type: "startRace",
      code,
      playerId: hostId,
    });
    expect(started.ok).toBe(false);
    expect(errorMessage(started.messages)).toMatch(/at least 2 players/i);
  });

  it("rejects joining a missing party", async () => {
    const missing = await post({
      type: "joinParty",
      code: "NOPE12",
      displayName: "Friend",
    });
    expect(missing.ok).toBe(false);
    expect(errorMessage(missing.messages)).toMatch(/party not found/i);
  });

  it("joins with a lowercase code", async () => {
    const { code } = await createHost();
    const joined = await post({
      type: "joinParty",
      code: code.toLowerCase(),
      displayName: "Friend",
    });
    expect(joined.ok).toBe(true);
    expect(names(joined.messages)).toEqual(["Friend", "Host"]);
  });

  it("lets the host see the friend after join and start the race", async () => {
    const { code, hostId } = await createHost("Murtaza");
    const joined = await post({
      type: "joinParty",
      code,
      displayName: "Friend",
    });
    expect(joined.ok).toBe(true);
    const friendId = joined.playerId;

    const hostPoll = await post({ type: "poll", code, playerId: hostId });
    expect(names(hostPoll.messages)).toEqual(["Friend", "Murtaza"]);
    expect(partyFrom(hostPoll.messages).players).toHaveLength(2);

    const started = await post({ type: "startRace", code, playerId: hostId });
    expect(started.ok).toBe(true);
    expect(partyFrom(started.messages).status).toBe("countdown");
    expect(started.messages.some((m) => m.type === "countdown")).toBe(true);

    const guestPoll = await post({ type: "poll", code, playerId: friendId });
    expect(guestPoll.messages.some((m) => m.type === "countdown")).toBe(true);
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

    const joined = await post({
      type: "joinParty",
      code: hostParty.code,
      displayName: "Friend",
    });
    expect(joined.ok).toBe(true);
    const friendId = joined.playerId;
    expect(friendId).not.toBe(hostId);
    expect(names(joined.messages)).toEqual(["Friend", "Murtaza"]);

    const started = await post({
      type: "startRace",
      code: hostParty.code,
      playerId: hostId,
    });
    expect(started.messages.some((m) => m.type === "countdown")).toBe(true);

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
      expect(partyFrom(racing.messages).words).toHaveLength(25);

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
      );
      expect(friend?.progress).toBe(40);

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
      expect(partyFrom(done.messages).winnerId).toBe(hostId);
    } finally {
      Date.now = originalNow;
    }
  });

  it("rejects a ninth player", async () => {
    const { code } = await createHost("P1");
    for (let i = 2; i <= 8; i++) {
      const joined = await post({
        type: "joinParty",
        code,
        displayName: `P${i}`,
      });
      expect(joined.ok).toBe(true);
    }
    const ninth = await post({
      type: "joinParty",
      code,
      displayName: "P9",
    });
    expect(ninth.ok).toBe(false);
    expect(errorMessage(ninth.messages)).toMatch(/full/i);
  });

  it("rejects joining after the race has started", async () => {
    const { code, hostId } = await createHost();
    await post({ type: "joinParty", code, displayName: "Friend" });
    await post({ type: "startRace", code, playerId: hostId });
    const late = await post({
      type: "joinParty",
      code,
      displayName: "Late",
    });
    expect(late.ok).toBe(false);
    expect(errorMessage(late.messages)).toMatch(/already started/i);
  });

  it("only the host can change settings and start", async () => {
    const { code, hostId } = await createHost();
    const joined = await post({
      type: "joinParty",
      code,
      displayName: "Friend",
    });
    const friendId = joined.playerId;
    const settings = await post({
      type: "updateSettings",
      code,
      playerId: friendId,
      settings: { mode: "quote", wordCount: 25, punctuation: false },
    });
    expect(settings.ok).toBe(false);
    expect(errorMessage(settings.messages)).toMatch(/only the host/i);

    const start = await post({
      type: "startRace",
      code,
      playerId: friendId,
    });
    expect(start.ok).toBe(false);
    expect(errorMessage(start.messages)).toMatch(/only the host/i);

    const updated = await post({
      type: "updateSettings",
      code,
      playerId: hostId,
      settings: { mode: "words", wordCount: 100, punctuation: true },
    });
    expect(updated.ok).toBe(true);
    const party = partyFrom(updated.messages);
    expect(party.settings?.wordCount).toBe(100);
    expect(party.settings?.punctuation).toBe(true);
    expect(party.words).toHaveLength(100);
  });

  it("reconnects a player with the same playerId", async () => {
    const { code } = await createHost();
    const joined = await post({
      type: "joinParty",
      code,
      displayName: "Friend",
    });
    const again = await post({
      type: "joinParty",
      code,
      displayName: "Friend",
      playerId: joined.playerId,
    });
    expect(again.ok).toBe(true);
    expect(again.playerId).toBe(joined.playerId);
    expect(partyFrom(again.messages).players).toHaveLength(2);
  });

  it("removes a guest who leaves the lobby", async () => {
    const { code, hostId } = await createHost();
    const joined = await post({
      type: "joinParty",
      code,
      displayName: "Friend",
    });
    await post({
      type: "leave",
      code,
      playerId: joined.playerId,
    });
    const hostPoll = await post({ type: "poll", code, playerId: hostId });
    expect(names(hostPoll.messages)).toEqual(["Host"]);
  });

  it("deletes the party when the host leaves the lobby", async () => {
    const { code, hostId } = await createHost();
    await post({ type: "joinParty", code, displayName: "Friend" });
    await post({ type: "leave", code, playerId: hostId });
    const missing = await post({
      type: "joinParty",
      code,
      displayName: "Other",
    });
    expect(missing.ok).toBe(false);
    expect(errorMessage(missing.messages)).toMatch(/party not found/i);
  });

  it("creates quote races with more than one word", async () => {
    const { words } = await createHost("Host", {
      mode: "quote",
      wordCount: 25,
      punctuation: false,
    });
    expect(words.length).toBeGreaterThan(1);
  });

  it("rejects poll for an unknown player", async () => {
    const { code } = await createHost();
    const polled = await post({
      type: "poll",
      code,
      playerId: "not-a-player",
    });
    expect(polled.ok).toBe(false);
    expect(errorMessage(polled.messages)).toMatch(/player not found/i);
  });

  it("shows three players to the host", async () => {
    const { code, hostId } = await createHost("A");
    await post({ type: "joinParty", code, displayName: "B" });
    await post({ type: "joinParty", code, displayName: "C" });
    const hostPoll = await post({ type: "poll", code, playerId: hostId });
    expect(names(hostPoll.messages)).toEqual(["A", "B", "C"]);
  });

  it("uses a fallback name when displayName is blank", async () => {
    const created = await post({
      type: "createParty",
      displayName: "   ",
      settings: { mode: "words", wordCount: 25 },
    });
    expect(partyFrom(created.messages).players[0]?.displayName).toBe("Host");
  });
});

describe("HTTP race room — separate instances", () => {
  beforeEach(() => {
    resetRaceRoomsForTests();
  });

  it("lets a friend join after the host's instance loses memory", async () => {
    const remote = createRemoteStore();
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
    expect(names(joined.messages)).toEqual(["Friend", "Host"]);

    resetRaceRoomsForTests();
    const hostPoll = await post({
      type: "poll",
      code: hostParty.code,
      playerId: created.playerId,
    });
    expect(hostPoll.ok).toBe(true);
    expect(names(hostPoll.messages)).toEqual(["Friend", "Host"]);
  });

  it("lets the host start after a friend joined on another instance", async () => {
    const remote = createRemoteStore();
    setRaceDurableStoreForTests(remote);
    const { code, hostId } = await createHost();

    resetRaceRoomsForTests();
    const joined = await post({
      type: "joinParty",
      code,
      displayName: "Friend",
    });
    expect(joined.ok).toBe(true);

    resetRaceRoomsForTests();
    const started = await post({
      type: "startRace",
      code,
      playerId: hostId,
    });
    expect(started.ok).toBe(true);
    expect(partyFrom(started.messages).status).toBe("countdown");
    expect(partyFrom(started.messages).players).toHaveLength(2);
  });

  it("keeps both players through isolate hops for the full race", async () => {
    const remote = createRemoteStore();
    setRaceDurableStoreForTests(remote);
    const { code, hostId, words } = await createHost();

    resetRaceRoomsForTests();
    const joined = await post({
      type: "joinParty",
      code,
      displayName: "Friend",
    });
    const friendId = joined.playerId;

    resetRaceRoomsForTests();
    const hostLobby = await post({ type: "poll", code, playerId: hostId });
    expect(names(hostLobby.messages)).toEqual(["Friend", "Host"]);

    resetRaceRoomsForTests();
    await post({ type: "startRace", code, playerId: hostId });

    const originalNow = Date.now;
    Date.now = () => originalNow() + 4000;
    try {
      resetRaceRoomsForTests();
      const racing = await post({ type: "poll", code, playerId: friendId });
      expect(partyFrom(racing.messages).status).toBe("racing");
      expect(partyFrom(racing.messages).words).toEqual(words);

      resetRaceRoomsForTests();
      await post({
        type: "progress",
        code,
        playerId: friendId,
        progress: 70,
      });

      resetRaceRoomsForTests();
      const hostMid = await post({ type: "poll", code, playerId: hostId });
      expect(
        partyFrom(hostMid.messages).players.find(
          (p) => p.displayName === "Friend",
        )?.progress,
      ).toBe(70);

      resetRaceRoomsForTests();
      await post({ type: "finished", code, playerId: friendId, timeMs: 5000 });
      resetRaceRoomsForTests();
      const hostDone = await post({
        type: "finished",
        code,
        playerId: hostId,
        timeMs: 7000,
      });
      expect(partyFrom(hostDone.messages).status).toBe("finished");
      expect(partyFrom(hostDone.messages).winnerId).toBe(friendId);
    } finally {
      Date.now = originalNow;
    }
  });

  it("does not let a stale host poll erase a friend from the store", async () => {
    const remote = createRemoteStore({ staleGets: true });
    setRaceDurableStoreForTests(remote);
    const { code, hostId } = await createHost();

    await post({ type: "poll", code, playerId: hostId });

    const joined = await post({
      type: "joinParty",
      code,
      displayName: "Friend",
    });
    expect(joined.ok).toBe(true);

    resetRaceRoomsForTests();
    await post({ type: "poll", code, playerId: hostId });

    const stored = remote.peek(code);
    expect(stored).toBeDefined();
    expect(Object.keys(stored?.players ?? {}).length).toBe(2);

    remote.bust();
    resetRaceRoomsForTests();
    const fresh = await post({ type: "poll", code, playerId: hostId });
    expect(names(fresh.messages)).toEqual(["Friend", "Host"]);

    const started = await post({
      type: "startRace",
      code,
      playerId: hostId,
    });
    expect(started.ok).toBe(true);
  });

  it("propagates host settings to a friend on another instance", async () => {
    const remote = createRemoteStore();
    setRaceDurableStoreForTests(remote);
    const { code, hostId } = await createHost();
    resetRaceRoomsForTests();
    const joined = await post({
      type: "joinParty",
      code,
      displayName: "Friend",
    });
    const friendId = joined.playerId;

    resetRaceRoomsForTests();
    await post({
      type: "updateSettings",
      code,
      playerId: hostId,
      settings: { mode: "words", wordCount: 100, punctuation: false },
    });

    resetRaceRoomsForTests();
    const guest = await post({ type: "poll", code, playerId: friendId });
    expect(partyFrom(guest.messages).settings?.wordCount).toBe(100);
    expect(partyFrom(guest.messages).words).toHaveLength(100);
  });

  it("reports health as the durable store when configured", async () => {
    setRaceDurableStoreForTests(createRemoteStore());
    const health = await getHealth();
    expect(health.store).toBe("test-remote");
  });
});
