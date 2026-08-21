import { describe, expect, it, beforeEach } from "vitest";
import { RaceServerMessageSchema } from "@typeai/schemas/race";
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
  settings?: {
    mode?: string;
    wordCount?: number;
    time?: number;
    punctuation?: boolean;
  };
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
            time?: number;
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

function ofType(
  messages: { type: string; [k: string]: unknown }[],
  type: string,
): { type: string; [k: string]: unknown }[] {
  return messages.filter((m) => m.type === type);
}

function expectClientAccepts(
  messages: { type: string; [k: string]: unknown }[],
): void {
  for (const raw of messages) {
    const parsed = RaceServerMessageSchema.safeParse(raw);
    expect(parsed.success, JSON.stringify(parsed.error ?? raw)).toBe(true);
  }
}

function raceStartWords(
  messages: { type: string; [k: string]: unknown }[],
): string[] {
  const start = ofType(messages, "raceStart")[0] as
    | { words?: string[] }
    | undefined;
  if (start?.words === undefined) throw new Error("missing raceStart words");
  return start.words;
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

describe("HTTP race room — after start", () => {
  beforeEach(() => {
    resetRaceRoomsForTests();
    setRaceDurableStoreForTests(createRemoteStore());
  });

  async function lobby(): Promise<{
    code: string;
    hostId: string;
    friendId: string;
    words: string[];
  }> {
    const { code, hostId, words } = await createHost();
    resetRaceRoomsForTests();
    const joined = await post({
      type: "joinParty",
      code,
      displayName: "Friend",
    });
    expect(joined.ok).toBe(true);
    return { code, hostId, friendId: joined.playerId as string, words };
  }

  async function goRacing(opts: {
    code: string;
    hostId: string;
    friendId: string;
  }): Promise<{
    host: Awaited<ReturnType<typeof post>>;
    friend: Awaited<ReturnType<typeof post>>;
  }> {
    resetRaceRoomsForTests();
    await post({
      type: "startRace",
      code: opts.code,
      playerId: opts.hostId,
      settings: { mode: "words", wordCount: 25, punctuation: false },
    });
    const originalNow = Date.now;
    Date.now = () => originalNow() + 4000;
    try {
      resetRaceRoomsForTests();
      const host = await post({
        type: "poll",
        code: opts.code,
        playerId: opts.hostId,
      });
      resetRaceRoomsForTests();
      const friend = await post({
        type: "poll",
        code: opts.code,
        playerId: opts.friendId,
      });
      return { host, friend };
    } finally {
      Date.now = originalNow;
    }
  }

  it("gives both players the same wordset after start", async () => {
    const { code, hostId, friendId, words } = await lobby();
    resetRaceRoomsForTests();
    const started = await post({
      type: "startRace",
      code,
      playerId: hostId,
      settings: { mode: "words", wordCount: 25, punctuation: false },
    });
    expect(partyFrom(started.messages).words).toEqual(words);

    resetRaceRoomsForTests();
    const guest = await post({ type: "poll", code, playerId: friendId });
    expect(partyFrom(guest.messages).words).toEqual(words);
    expect(partyFrom(started.messages).words).toEqual(
      partyFrom(guest.messages).words,
    );
  });

  it("starts the race for both players with the same words", async () => {
    const session = await lobby();
    const { host, friend } = await goRacing(session);
    expect(partyFrom(host.messages).status).toBe("racing");
    expect(partyFrom(friend.messages).status).toBe("racing");
    expect(ofType(host.messages, "raceStart")).toHaveLength(1);
    expect(ofType(friend.messages, "raceStart")).toHaveLength(1);
    expect(raceStartWords(host.messages)).toEqual(
      raceStartWords(friend.messages),
    );
    expect(raceStartWords(host.messages)).toEqual(session.words);
    expect(partyFrom(host.messages).words).toEqual(session.words);
    expect(partyFrom(friend.messages).words).toEqual(session.words);
  });

  it("lets the host see the friend's live progress", async () => {
    const session = await lobby();
    await goRacing(session);
    resetRaceRoomsForTests();
    await post({
      type: "progress",
      code: session.code,
      playerId: session.friendId,
      progress: 35,
    });
    resetRaceRoomsForTests();
    const hostView = await post({
      type: "poll",
      code: session.code,
      playerId: session.hostId,
    });
    const friend = partyFrom(hostView.messages).players.find(
      (p) => p.displayName === "Friend",
    );
    expect(friend?.progress).toBe(35);
    expect(partyFrom(hostView.messages).status).toBe("racing");
  });

  it("lets the friend see the host's live progress", async () => {
    const session = await lobby();
    await goRacing(session);
    resetRaceRoomsForTests();
    await post({
      type: "progress",
      code: session.code,
      playerId: session.hostId,
      progress: 80,
    });
    resetRaceRoomsForTests();
    const friendView = await post({
      type: "poll",
      code: session.code,
      playerId: session.friendId,
    });
    const host = partyFrom(friendView.messages).players.find(
      (p) => p.displayName === "Host",
    );
    expect(host?.progress).toBe(80);
  });

  it("keeps tracking both ways after several progress ticks", async () => {
    const session = await lobby();
    await goRacing(session);
    const originalNow = Date.now;
    let now = originalNow();
    Date.now = () => now;
    try {
      for (const tick of [10, 25, 60]) {
        now += 250;
        resetRaceRoomsForTests();
        await post({
          type: "progress",
          code: session.code,
          playerId: session.friendId,
          progress: tick,
        });
        resetRaceRoomsForTests();
        const hostView = await post({
          type: "poll",
          code: session.code,
          playerId: session.hostId,
        });
        expect(
          partyFrom(hostView.messages).players.find(
            (p) => p.displayName === "Friend",
          )?.progress,
        ).toBe(tick);
      }
    } finally {
      Date.now = originalNow;
    }
  });

  it("marks the first finisher as winner and ends when both finish", async () => {
    const session = await lobby();
    await goRacing(session);

    resetRaceRoomsForTests();
    const friendDone = await post({
      type: "finished",
      code: session.code,
      playerId: session.friendId,
      timeMs: 4200,
    });
    expect(partyFrom(friendDone.messages).status).toBe("racing");
    expect(partyFrom(friendDone.messages).winnerId).toBe(session.friendId);

    resetRaceRoomsForTests();
    const hostSeesLead = await post({
      type: "poll",
      code: session.code,
      playerId: session.hostId,
    });
    const friend = partyFrom(hostSeesLead.messages).players.find(
      (p) => p.displayName === "Friend",
    );
    expect(friend?.progress).toBe(100);
    expect(friend?.timeMs).toBe(4200);
    expect(partyFrom(hostSeesLead.messages).winnerId).toBe(session.friendId);
    expect(partyFrom(hostSeesLead.messages).status).toBe("racing");

    resetRaceRoomsForTests();
    const hostDone = await post({
      type: "finished",
      code: session.code,
      playerId: session.hostId,
      timeMs: 6100,
    });
    expect(partyFrom(hostDone.messages).status).toBe("finished");
    expect(partyFrom(hostDone.messages).winnerId).toBe(session.friendId);
    expect(ofType(hostDone.messages, "raceComplete")).toHaveLength(1);
    const complete = ofType(hostDone.messages, "raceComplete")[0] as {
      winnerId?: string;
      standings?: { displayName: string; timeMs?: number | null }[];
    };
    expect(complete.winnerId).toBe(session.friendId);
    expect(complete.standings?.map((p) => p.displayName)).toEqual([
      "Friend",
      "Host",
    ]);
    expect(complete.standings?.[0]?.timeMs).toBe(4200);
    expect(complete.standings?.[1]?.timeMs).toBe(6100);

    resetRaceRoomsForTests();
    const friendEnd = await post({
      type: "poll",
      code: session.code,
      playerId: session.friendId,
    });
    expect(partyFrom(friendEnd.messages).status).toBe("finished");
    expect(partyFrom(friendEnd.messages).winnerId).toBe(session.friendId);
    expect(ofType(friendEnd.messages, "raceComplete")).toHaveLength(1);
  });

  it("lets the host play again in the same party so the friend stays", async () => {
    const session = await lobby();
    await goRacing(session);
    resetRaceRoomsForTests();
    await post({
      type: "finished",
      code: session.code,
      playerId: session.friendId,
      timeMs: 4200,
    });
    resetRaceRoomsForTests();
    await post({
      type: "finished",
      code: session.code,
      playerId: session.hostId,
      timeMs: 6100,
    });

    const guestReplay = await post({
      type: "playAgain",
      code: session.code,
      playerId: session.friendId,
    });
    expect(guestReplay.ok).toBe(false);
    expect(errorMessage(guestReplay.messages)).toMatch(/only the host/i);

    resetRaceRoomsForTests();
    const replay = await post({
      type: "playAgain",
      code: session.code,
      playerId: session.hostId,
    });
    expect(replay.ok).toBe(true);
    const replayed = partyFrom(replay.messages);
    expect(replayed.status).toBe("lobby");
    expect(replayed.code).toBe(session.code);
    expect(replayed.winnerId).toBeNull();
    expect(replayed.players).toHaveLength(2);
    expect(replayed.players.every((p) => p.timeMs == null)).toBe(true);
    expect(replayed.players.every((p) => p.progress === 0)).toBe(true);
    expectClientAccepts(replay.messages);

    resetRaceRoomsForTests();
    const friendLobby = await post({
      type: "poll",
      code: session.code,
      playerId: session.friendId,
    });
    expect(partyFrom(friendLobby.messages).status).toBe("lobby");
    expect(names(friendLobby.messages)).toEqual(["Friend", "Host"]);
  });

  it("cannot start after play again if the friend already left", async () => {
    const session = await lobby();
    await goRacing(session);
    resetRaceRoomsForTests();
    await post({
      type: "finished",
      code: session.code,
      playerId: session.friendId,
      timeMs: 4200,
    });
    resetRaceRoomsForTests();
    await post({
      type: "finished",
      code: session.code,
      playerId: session.hostId,
      timeMs: 6100,
    });
    resetRaceRoomsForTests();
    await post({
      type: "leave",
      code: session.code,
      playerId: session.friendId,
    });
    resetRaceRoomsForTests();
    const replay = await post({
      type: "playAgain",
      code: session.code,
      playerId: session.hostId,
    });
    expect(partyFrom(replay.messages).players).toHaveLength(1);
    const started = await post({
      type: "startRace",
      code: session.code,
      playerId: session.hostId,
    });
    expect(started.ok).toBe(false);
    expect(errorMessage(started.messages)).toMatch(/at least 2 players/i);
  });

  it("ends the race on the finish deadline and DNFs the slower player", async () => {
    const session = await lobby();
    const originalNow = Date.now;
    const startedAt = originalNow();
    Date.now = () => startedAt;
    try {
      resetRaceRoomsForTests();
      await post({
        type: "startRace",
        code: session.code,
        playerId: session.hostId,
      });
      Date.now = () => startedAt + 4000;
      resetRaceRoomsForTests();
      await post({
        type: "poll",
        code: session.code,
        playerId: session.hostId,
      });
      Date.now = () => startedAt + 5000;
      resetRaceRoomsForTests();
      await post({
        type: "finished",
        code: session.code,
        playerId: session.friendId,
        timeMs: 1000,
      });
      Date.now = () => startedAt + 70_000;
      resetRaceRoomsForTests();
      const timedOut = await post({
        type: "poll",
        code: session.code,
        playerId: session.hostId,
      });
      expect(partyFrom(timedOut.messages).status).toBe("finished");
      expect(partyFrom(timedOut.messages).winnerId).toBe(session.friendId);
      expect(ofType(timedOut.messages, "raceComplete")).toHaveLength(1);
      const hostPlayer = partyFrom(timedOut.messages).players.find(
        (p) => p.displayName === "Host",
      );
      const friendPlayer = partyFrom(timedOut.messages).players.find(
        (p) => p.displayName === "Friend",
      );
      expect(friendPlayer?.timeMs).toBe(1000);
      expect(hostPlayer?.timeMs ?? null).toBeNull();
    } finally {
      Date.now = originalNow;
    }
  });

  it("does not change the winner if a slower player finishes later", async () => {
    const session = await lobby();
    await goRacing(session);
    resetRaceRoomsForTests();
    await post({
      type: "finished",
      code: session.code,
      playerId: session.hostId,
      timeMs: 3000,
    });
    resetRaceRoomsForTests();
    const done = await post({
      type: "finished",
      code: session.code,
      playerId: session.friendId,
      timeMs: 9000,
    });
    expect(partyFrom(done.messages).winnerId).toBe(session.hostId);
    expect(partyFrom(done.messages).status).toBe("finished");
  });

  it("ends the race if nobody finishes before the hard timeout", async () => {
    const session = await lobby();
    const originalNow = Date.now;
    const startedAt = originalNow();
    Date.now = () => startedAt;
    try {
      resetRaceRoomsForTests();
      await post({
        type: "startRace",
        code: session.code,
        playerId: session.hostId,
      });
      Date.now = () => startedAt + 4000;
      resetRaceRoomsForTests();
      const racing = await post({
        type: "poll",
        code: session.code,
        playerId: session.hostId,
      });
      expect(partyFrom(racing.messages).status).toBe("racing");

      Date.now = () => startedAt + 4000 + 11 * 60 * 1000;
      resetRaceRoomsForTests();
      const timedOut = await post({
        type: "poll",
        code: session.code,
        playerId: session.friendId,
      });
      expect(partyFrom(timedOut.messages).status).toBe("finished");
      expect(ofType(timedOut.messages, "raceComplete")).toHaveLength(1);
    } finally {
      Date.now = originalNow;
    }
  });

  it("ends the race when the host leaves mid-race so the friend is not stuck", async () => {
    const session = await lobby();
    await goRacing(session);
    resetRaceRoomsForTests();
    await post({
      type: "leave",
      code: session.code,
      playerId: session.hostId,
    });
    resetRaceRoomsForTests();
    const friendView = await post({
      type: "poll",
      code: session.code,
      playerId: session.friendId,
    });
    expect(partyFrom(friendView.messages).status).toBe("finished");
    expect(ofType(friendView.messages, "raceComplete")).toHaveLength(1);
    expect(
      partyFrom(friendView.messages).players.find(
        (p) => p.displayName === "Friend",
      )?.isHost,
    ).toBe(true);

    resetRaceRoomsForTests();
    const replay = await post({
      type: "playAgain",
      code: session.code,
      playerId: session.friendId,
    });
    expect(replay.ok).toBe(true);
    expect(partyFrom(replay.messages).status).toBe("lobby");
    expect(partyFrom(replay.messages).hostId).toBe(session.friendId);

    const created = await post({
      type: "createParty",
      displayName: "Host",
      settings: { mode: "words", wordCount: 25, punctuation: false },
    });
    expect(created.ok).toBe(true);
    expect(partyFrom(created.messages).status).toBe("lobby");
    expect(partyFrom(created.messages).code).not.toBe(session.code);
  });

  it("re-sends raceStart when a player reconnects mid-race", async () => {
    const session = await lobby();
    await goRacing(session);
    resetRaceRoomsForTests();
    const rejoin = await post({
      type: "joinParty",
      code: session.code,
      displayName: "Friend",
      playerId: session.friendId,
    });
    expect(rejoin.ok).toBe(true);
    expect(partyFrom(rejoin.messages).status).toBe("racing");
    expect(ofType(rejoin.messages, "raceStart")).toHaveLength(1);
    expectClientAccepts(rejoin.messages);
  });

  it("never lowers a player's progress", async () => {
    const session = await lobby();
    await goRacing(session);
    resetRaceRoomsForTests();
    await post({
      type: "progress",
      code: session.code,
      playerId: session.friendId,
      progress: 40,
    });
    resetRaceRoomsForTests();
    await post({
      type: "progress",
      code: session.code,
      playerId: session.friendId,
      progress: 10,
    });
    resetRaceRoomsForTests();
    const hostView = await post({
      type: "poll",
      code: session.code,
      playerId: session.hostId,
    });
    expect(
      partyFrom(hostView.messages).players.find(
        (p) => p.displayName === "Friend",
      )?.progress,
    ).toBe(40);
  });

  it("creates a timed race with enough words to last the clock", async () => {
    const created = await post({
      type: "createParty",
      displayName: "Host",
      settings: { mode: "time", time: 15, wordCount: 50, punctuation: false },
    });
    expect(created.ok).toBe(true);
    expect(partyFrom(created.messages).settings?.mode).toBe("time");
    expect(partyFrom(created.messages).settings?.time).toBe(15);
    expect(partyFrom(created.messages).words.length).toBeGreaterThanOrEqual(
      200,
    );
  });

  it("ranks a timed race by progress, not first to send finished", async () => {
    const created = await post({
      type: "createParty",
      displayName: "Host",
      settings: { mode: "time", time: 15, punctuation: false },
    });
    const code = partyFrom(created.messages).code;
    const hostId = created.playerId as string;
    const joined = await post({
      type: "joinParty",
      code,
      displayName: "Friend",
    });
    const friendId = joined.playerId as string;
    const originalNow = Date.now;
    const startedAt = originalNow();
    Date.now = () => startedAt;
    try {
      await post({ type: "startRace", code, playerId: hostId });
      Date.now = () => startedAt + 4000;
      await post({ type: "poll", code, playerId: hostId });
      Date.now = () => startedAt + 4500;
      await post({
        type: "progress",
        code,
        playerId: friendId,
        progress: 40,
      });
      await post({
        type: "finished",
        code,
        playerId: friendId,
        timeMs: 15000,
      });
      Date.now = () => startedAt + 4800;
      await post({
        type: "progress",
        code,
        playerId: hostId,
        progress: 72,
      });
      const hostDone = await post({
        type: "finished",
        code,
        playerId: hostId,
        timeMs: 15020,
      });
      expect(partyFrom(hostDone.messages).status).toBe("finished");
      expect(partyFrom(hostDone.messages).winnerId).toBe(hostId);
      const friend = partyFrom(hostDone.messages).players.find(
        (p) => p.displayName === "Friend",
      );
      expect(friend?.progress).toBe(40);
    } finally {
      Date.now = originalNow;
    }
  });
});

describe("HTTP race room — client schema and full flows", () => {
  beforeEach(() => {
    resetRaceRoomsForTests();
    setRaceDurableStoreForTests(createRemoteStore());
  });

  it("lets both players finish a 25-word race and start a new party after", async () => {
    const created = await post({
      type: "createParty",
      displayName: "Host",
      settings: { mode: "words", wordCount: 25, punctuation: false },
    });
    expectClientAccepts(created.messages);
    const code = partyFrom(created.messages).code;
    const hostId = created.playerId as string;
    expect(partyFrom(created.messages).words).toHaveLength(25);
    expect(partyFrom(created.messages).settings?.mode).toBe("words");

    const joined = await post({
      type: "joinParty",
      code,
      displayName: "Friend",
    });
    expectClientAccepts(joined.messages);
    const friendId = joined.playerId as string;
    expect(partyFrom(joined.messages).players).toHaveLength(2);

    const started = await post({
      type: "startRace",
      code,
      playerId: hostId,
      settings: { mode: "words", wordCount: 25, time: 30, punctuation: false },
    });
    expectClientAccepts(started.messages);
    expect(partyFrom(started.messages).status).toBe("countdown");

    const originalNow = Date.now;
    Date.now = () => originalNow() + 4000;
    try {
      const racing = await post({ type: "poll", code, playerId: friendId });
      expectClientAccepts(racing.messages);
      expect(partyFrom(racing.messages).status).toBe("racing");
      expect(partyFrom(racing.messages).words).toHaveLength(25);
      expect(ofType(racing.messages, "raceStart")).toHaveLength(1);
      const start = ofType(racing.messages, "raceStart")[0] as {
        words?: string[];
        settings?: { mode?: string; wordCount?: number };
      };
      expect(start.words).toHaveLength(25);
      expect(start.settings?.mode).toBe("words");

      await post({
        type: "progress",
        code,
        playerId: friendId,
        progress: 40,
      });
      const hostMid = await post({ type: "poll", code, playerId: hostId });
      expectClientAccepts(hostMid.messages);
      expect(
        partyFrom(hostMid.messages).players.find(
          (p) => p.displayName === "Friend",
        )?.progress,
      ).toBe(40);

      const friendDone = await post({
        type: "finished",
        code,
        playerId: friendId,
        timeMs: 8000,
      });
      expectClientAccepts(friendDone.messages);
      expect(partyFrom(friendDone.messages).status).toBe("racing");
      expect(partyFrom(friendDone.messages).winnerId).toBe(friendId);

      const hostDone = await post({
        type: "finished",
        code,
        playerId: hostId,
        timeMs: 9000,
      });
      expectClientAccepts(hostDone.messages);
      expect(partyFrom(hostDone.messages).status).toBe("finished");
      expect(partyFrom(hostDone.messages).winnerId).toBe(friendId);
      expect(ofType(hostDone.messages, "raceComplete")).toHaveLength(1);
    } finally {
      Date.now = originalNow;
    }

    const again = await post({
      type: "createParty",
      displayName: "Host",
      settings: { mode: "words", wordCount: 50, punctuation: false },
    });
    expectClientAccepts(again.messages);
    expect(partyFrom(again.messages).status).toBe("lobby");
    expect(partyFrom(again.messages).code).not.toBe(code);
    expect(partyFrom(again.messages).words).toHaveLength(50);
  });

  it("lets both players finish a timed race with client-parseable messages", async () => {
    const created = await post({
      type: "createParty",
      displayName: "Host",
      settings: { mode: "time", time: 15, punctuation: false },
    });
    expectClientAccepts(created.messages);
    expect(partyFrom(created.messages).settings?.mode).toBe("time");
    expect(partyFrom(created.messages).settings?.time).toBe(15);
    expect(partyFrom(created.messages).words.length).toBeGreaterThanOrEqual(
      200,
    );

    const code = partyFrom(created.messages).code;
    const hostId = created.playerId as string;
    const joined = await post({
      type: "joinParty",
      code,
      displayName: "Friend",
    });
    expectClientAccepts(joined.messages);
    const friendId = joined.playerId as string;

    const originalNow = Date.now;
    const startedAt = originalNow();
    Date.now = () => startedAt;
    try {
      const started = await post({ type: "startRace", code, playerId: hostId });
      expectClientAccepts(started.messages);
      Date.now = () => startedAt + 4000;
      const racing = await post({ type: "poll", code, playerId: hostId });
      expectClientAccepts(racing.messages);
      expect(partyFrom(racing.messages).status).toBe("racing");
      const start = ofType(racing.messages, "raceStart")[0] as {
        settings?: { mode?: string; time?: number };
        words?: string[];
      };
      expect(start.settings?.mode).toBe("time");
      expect(start.settings?.time).toBe(15);
      expect(start.words?.length).toBeGreaterThanOrEqual(200);

      Date.now = () => startedAt + 4500;
      await post({
        type: "progress",
        code,
        playerId: hostId,
        progress: 55,
      });
      await post({
        type: "finished",
        code,
        playerId: hostId,
        timeMs: 15000,
      });
      Date.now = () => startedAt + 5000;
      await post({
        type: "progress",
        code,
        playerId: friendId,
        progress: 30,
      });
      const friendDone = await post({
        type: "finished",
        code,
        playerId: friendId,
        timeMs: 15100,
      });
      expectClientAccepts(friendDone.messages);
      expect(partyFrom(friendDone.messages).status).toBe("finished");
      expect(partyFrom(friendDone.messages).winnerId).toBe(hostId);
      expect(
        partyFrom(friendDone.messages).players.find(
          (p) => p.displayName === "Host",
        )?.progress,
      ).toBe(55);
    } finally {
      Date.now = originalNow;
    }
  });

  it("ends a countdown if the host leaves so a new race can start", async () => {
    const created = await post({
      type: "createParty",
      displayName: "Host",
      settings: { mode: "quote", wordCount: 25, punctuation: false },
    });
    expectClientAccepts(created.messages);
    const code = partyFrom(created.messages).code;
    const hostId = created.playerId as string;
    const joined = await post({
      type: "joinParty",
      code,
      displayName: "Friend",
    });
    const friendId = joined.playerId as string;
    await post({ type: "startRace", code, playerId: hostId });
    await post({ type: "leave", code, playerId: hostId });
    const friendView = await post({ type: "poll", code, playerId: friendId });
    expectClientAccepts(friendView.messages);
    expect(partyFrom(friendView.messages).status).toBe("finished");
    expect(ofType(friendView.messages, "raceComplete")).toHaveLength(1);

    const next = await post({
      type: "createParty",
      displayName: "Host",
      settings: { mode: "time", time: 30, punctuation: false },
    });
    expectClientAccepts(next.messages);
    expect(partyFrom(next.messages).status).toBe("lobby");
    expect(partyFrom(next.messages).settings?.mode).toBe("time");
  });
});
