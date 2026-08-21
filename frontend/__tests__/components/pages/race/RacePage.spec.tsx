import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const memory = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string): string | null => memory.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      memory.set(key, value);
    },
    removeItem: (key: string): void => {
      memory.delete(key);
    },
    clear: (): void => {
      memory.clear();
    },
    key: (): string | null => null,
    get length(): number {
      return memory.size;
    },
  },
});

vi.mock("../../../../src/ts/race/client", () => ({
  connectRaceWs: vi.fn().mockResolvedValue(undefined),
  createParty: vi.fn(),
  joinParty: vi.fn(),
  onRaceMessage: vi.fn(() => vi.fn()),
  startRace: vi.fn(),
  updateRaceSettings: vi.fn(),
  playAgain: vi.fn(),
}));

vi.mock("../../../../src/ts/race/controller", () => ({
  leaveRaceAndRestore: vi.fn(),
}));

vi.mock("../../../../src/ts/controllers/route-controller", () => ({
  navigate: vi.fn(),
}));

vi.mock("../../../../src/ts/states/notifications", () => ({
  showErrorNotification: vi.fn(),
}));

import { RacePlayer } from "@typeai/schemas/race";

import { RacePage } from "../../../../src/ts/components/pages/race/RacePage";
import { setActivePage } from "../../../../src/ts/states/core";
import {
  setRaceError,
  setRaceParty,
  setRaceWsConnected,
  setRaceYou,
} from "../../../../src/ts/states/race";

const host: RacePlayer = {
  id: "host-1",
  displayName: "Host",
  progress: 0,
  finishedAt: null,
  timeMs: null,
  connected: true,
  isHost: true,
};

const friend: RacePlayer = {
  id: "friend-1",
  displayName: "Sam",
  progress: 0,
  finishedAt: null,
  timeMs: null,
  connected: true,
  isHost: false,
};

function lobby(players: RacePlayer[]) {
  return {
    code: "ABC123",
    status: "lobby" as const,
    hostId: host.id,
    words: ["the", "quick"],
    settings: {
      mode: "words" as const,
      wordCount: 25 as const,
      time: 30 as const,
      punctuation: false,
    },
    players,
    inviteUrl: "https://typeaiapp.vercel.app/race/ABC123",
    startedAt: null,
    countdownEndsAt: null,
    winnerId: null,
  };
}

describe("RacePage lobby", () => {
  beforeEach(() => {
    setActivePage("race");
    setRaceWsConnected(true);
    setRaceError(null);
    setRaceYou(host);
    setRaceParty(lobby([host]));
  });

  afterEach(() => {
    cleanup();
    setRaceParty(null);
    setRaceYou(null);
    setRaceWsConnected(false);
    setActivePage("loading");
  });

  it("shows a friend on the host lobby when party state updates", () => {
    const { container } = render(() => <RacePage />);
    const text = (): string => container.textContent ?? "";
    expect(text()).toContain("Host");
    expect(text()).not.toContain("Sam");
    expect(text()).toContain("Players (1/8)");
    expect(text()).toContain("Need at least 2 players to start");

    setRaceParty(lobby([host, friend]));

    expect(text()).toContain("Sam");
    expect(text()).toContain("Players (2/8)");
    expect(text()).not.toContain("Need at least 2 players to start");
  });

  it("offers timed mode next to words and quotes", () => {
    const { container } = render(() => <RacePage />);
    const text = container.textContent ?? "";
    expect(text).toContain("Time");
    expect(text).toContain("Words");
    expect(text).toContain("Quote");
  });

  it("lets either player leave a race in progress", () => {
    setRaceParty({
      ...lobby([host, friend]),
      status: "racing",
    });
    const { container } = render(() => <RacePage />);
    expect(container.textContent).toContain("Leave race");
  });

  it("shows a race complete screen when the party finishes", () => {
    setRaceParty({
      ...lobby([
        { ...host, timeMs: 4200, progress: 100 },
        { ...friend, timeMs: 6100, progress: 100 },
      ]),
      status: "finished",
      winnerId: host.id,
    });
    const { container } = render(() => <RacePage />);
    expect(container.textContent).toContain("Race complete");
    expect(container.textContent).toContain("winner");
    expect(container.textContent).toContain("4.20s");
    expect(container.textContent).toContain("Play again");
  });

  it("tells a guest to wait for the host after the race", () => {
    setRaceYou(friend);
    setRaceParty({
      ...lobby([
        { ...host, timeMs: 4200, progress: 100 },
        { ...friend, timeMs: 6100, progress: 100 },
      ]),
      status: "finished",
      winnerId: host.id,
    });
    const { container } = render(() => <RacePage />);
    expect(container.textContent).toContain("Race complete");
    expect(container.textContent).toContain("Waiting for the host");
    expect(container.textContent).not.toContain("Play again");
  });
});
