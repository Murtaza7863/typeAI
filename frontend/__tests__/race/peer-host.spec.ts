import { describe, expect, it, vi, type Mock } from "vitest";
import {
  RACE_COUNTDOWN_SECONDS,
  RACE_MAX_PLAYERS,
  RACE_WORD_COUNT,
} from "@typeai/schemas/race";
import type { DataConnection, Peer } from "peerjs";
import {
  generateRaceText,
  generateRaceWordList,
} from "../../src/ts/race/word-list";
import { PeerRaceHost } from "../../src/ts/race/peer-host";

function mockPeer(id = "abcdef"): {
  peer: Peer;
  connectionHandler: (conn: DataConnection) => void;
} {
  let connectionHandler: (conn: DataConnection) => void = () => {
    // set by PeerRaceHost constructor
  };
  const peer = {
    id,
    on: vi.fn((event: string, cb: (conn: DataConnection) => void) => {
      if (event === "connection") connectionHandler = cb;
    }),
  } as unknown as Peer;
  return {
    peer,
    get connectionHandler() {
      return connectionHandler;
    },
  };
}

function mockConnection(): DataConnection & {
  emitData: (data: unknown) => void;
} {
  let dataHandler: (data: unknown) => void = () => {
    // set on connection
  };
  const conn = {
    open: true,
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn((event: string, cb: (data: unknown) => void) => {
      if (event === "data") dataHandler = cb;
    }),
    emitData: (data: unknown) => dataHandler(data),
  };
  return conn as unknown as DataConnection & {
    emitData: (data: unknown) => void;
  };
}

describe("frontend race word list", () => {
  it("generates the shared race length", () => {
    const words = generateRaceWordList();
    expect(words).toHaveLength(RACE_WORD_COUNT);
  });

  it("supports 25/100 words, punctuation, and quotes", () => {
    expect(
      generateRaceText({
        mode: "words",
        wordCount: 25,
        time: 30,
        punctuation: false,
      }),
    ).toHaveLength(25);
    expect(
      generateRaceText({
        mode: "words",
        wordCount: 100,
        time: 30,
        punctuation: false,
      }),
    ).toHaveLength(100);
    const punctuated = generateRaceText({
      mode: "words",
      wordCount: 50,
      time: 30,
      punctuation: true,
    });
    expect(punctuated.some((w) => /[.,!?;:]/.test(w))).toBe(true);
    const quote = generateRaceText({
      mode: "quote",
      wordCount: 50,
      time: 30,
      punctuation: false,
    });
    expect(quote.length).toBeGreaterThan(0);
    expect(
      generateRaceText({
        mode: "time",
        wordCount: 50,
        time: 15,
        punctuation: false,
      }).length,
    ).toBeGreaterThanOrEqual(200);
  });
});

describe("PeerRaceHost", () => {
  it("creates a lobby and notifies the host", () => {
    const onMessage = vi.fn();
    const { peer } = mockPeer("hostid1");
    const host = new PeerRaceHost(peer, { onMessage, sendTo: vi.fn() });
    const code = host.createParty("Alice");
    expect(code).toBe("HOSTID1");
    expect(onMessage).toHaveBeenCalled();
    const first = onMessage.mock.calls[0]?.[1] as {
      type: string;
      party?: {
        status: string;
        words: string[];
        settings?: { wordCount: number };
      };
      you?: { isHost: boolean; displayName: string };
    };
    expect(first.type).toBe("partyState");
    expect(first.party?.status).toBe("lobby");
    expect(first.party?.words).toHaveLength(RACE_WORD_COUNT);
    expect(first.party?.settings?.wordCount).toBe(50);
    expect(first.you?.isHost).toBe(true);
    expect(first.you?.displayName).toBe("Alice");
  });

  it("updates settings in the lobby", () => {
    const onMessage = vi.fn();
    const { peer } = mockPeer("hostid1");
    const host = new PeerRaceHost(peer, { onMessage, sendTo: vi.fn() });
    host.createParty("Alice");
    onMessage.mockClear();
    host.handleLocalMessage({
      type: "updateSettings",
      settings: { mode: "words", wordCount: 25, time: 30, punctuation: true },
    });
    const state = onMessage.mock.calls[0]?.[1] as {
      type: string;
      party?: { words: string[]; settings: { wordCount: number } };
    };
    expect(state.type).toBe("partyState");
    expect(state.party?.settings.wordCount).toBe(25);
    expect(state.party?.words).toHaveLength(25);
  });

  it("ignores duplicate joinParty on the same connection", () => {
    const onMessage = vi.fn();
    const sendTo = vi.fn();
    const mocked = mockPeer("hostid1");
    const host = new PeerRaceHost(mocked.peer, { onMessage, sendTo });
    host.createParty("Host");
    const conn = mockConnection();
    mocked.connectionHandler(conn);
    conn.emitData({
      type: "joinParty",
      code: "HOSTID1",
      displayName: "Guest",
    });
    conn.emitData({
      type: "joinParty",
      code: "HOSTID1",
      displayName: "Guest",
    });

    const lobby = onMessage.mock.calls
      .map((c) => c[1] as { type: string; party?: { players: unknown[] } })
      .filter((msg) => msg.type === "partyState")
      .at(-1);
    expect(lobby?.party?.players).toHaveLength(2);
  });

  it("adds guests over the data channel and enforces max players", () => {
    const onMessage = vi.fn();
    const sendTo = vi.fn();
    const mocked = mockPeer("hostid1");
    const host = new PeerRaceHost(mocked.peer, { onMessage, sendTo });
    host.createParty("Host");

    for (let i = 0; i < RACE_MAX_PLAYERS - 1; i++) {
      const conn = mockConnection();
      mocked.connectionHandler(conn);
      conn.emitData({
        type: "joinParty",
        code: "HOSTID1",
        displayName: `G${i}`,
      });
    }

    const overflow = mockConnection();
    mocked.connectionHandler(overflow);
    overflow.emitData({
      type: "joinParty",
      code: "HOSTID1",
      displayName: "Overflow",
    });

    expect(sendTo).toHaveBeenCalledWith(
      overflow,
      expect.objectContaining({
        type: "error",
        message: expect.stringMatching(/full/i) as string,
      }),
    );
  });

  it("starts countdown then race when host starts with 2+ players", () => {
    vi.useFakeTimers();
    const onMessage = vi.fn();
    const mocked = mockPeer("hostid1");
    const host = new PeerRaceHost(mocked.peer, {
      onMessage,
      sendTo: vi.fn(),
    });
    host.createParty("Host");
    const guestConn = mockConnection();
    mocked.connectionHandler(guestConn);
    guestConn.emitData({
      type: "joinParty",
      code: "HOSTID1",
      displayName: "Guest",
    });

    host.handleLocalMessage({ type: "startRace" });
    expect(
      (onMessage.mock.calls as unknown as [string, { type: string }][]).some(
        (c) => c[1].type === "countdown",
      ),
    ).toBe(true);

    vi.advanceTimersByTime(RACE_COUNTDOWN_SECONDS * 1000);
    expect(
      (onMessage.mock.calls as unknown as [string, { type: string }][]).some(
        (c) => c[1].type === "raceStart",
      ),
    ).toBe(true);
    vi.useRealTimers();
  });

  it("rejects start with fewer than 2 players", () => {
    const onMessage = vi.fn();
    const { peer } = mockPeer("hostid1");
    const host = new PeerRaceHost(peer, { onMessage, sendTo: vi.fn() });
    host.createParty("Host");
    host.handleLocalMessage({ type: "startRace" });
    expect(
      onMessage.mock.calls.some((c) => {
        const msg = c[1] as { type: string; message?: string };
        return (
          msg.type === "error" && msg.message?.includes("2 players") === true
        );
      }),
    ).toBe(true);
  });

  it("tracks progress and completes when all finish", () => {
    vi.useFakeTimers();
    const onMessage = vi.fn();
    const mocked = mockPeer("hostid1");
    const host = new PeerRaceHost(mocked.peer, {
      onMessage,
      sendTo: vi.fn(),
    });
    host.createParty("Host");
    const guestConn = mockConnection();
    mocked.connectionHandler(guestConn);
    guestConn.emitData({
      type: "joinParty",
      code: "HOSTID1",
      displayName: "Guest",
    });

    host.handleLocalMessage({ type: "startRace" });
    vi.advanceTimersByTime(RACE_COUNTDOWN_SECONDS * 1000);

    host.handleLocalMessage({ type: "progress", progress: 40 });
    expect(
      onMessage.mock.calls.some(
        (c) => (c[1] as { type: string }).type === "progressUpdate",
      ),
    ).toBe(true);

    host.handleLocalMessage({ type: "finished", timeMs: 10000 });
    guestConn.emitData({ type: "finished", timeMs: 12000 });

    expect(
      onMessage.mock.calls.some(
        (c) => (c[1] as { type: string }).type === "raceComplete",
      ),
    ).toBe(true);
    vi.useRealTimers();
  });
});

// silence unused Mock import if lint complains via type-only usage
void 0 as unknown as Mock;
