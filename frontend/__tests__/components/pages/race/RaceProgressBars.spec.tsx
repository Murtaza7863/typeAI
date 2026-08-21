import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/ts/race/controller", () => ({
  leaveRaceAndRestore: vi.fn(),
  openRaceResults: vi.fn(),
}));

vi.mock("../../../../src/ts/controllers/route-controller", () => ({
  navigate: vi.fn(),
}));

vi.mock("../../../../src/ts/race/client", () => ({
  playAgain: vi.fn(),
}));

import { RaceProgressBars } from "../../../../src/ts/components/pages/race/RaceProgressBars";
import { setActivePage } from "../../../../src/ts/states/core";
import {
  setIsRaceActive,
  setLocalFinished,
  setRaceParty,
  setRaceYou,
  setStandings,
} from "../../../../src/ts/states/race";

const host = {
  id: "host-1",
  displayName: "Host",
  progress: 100,
  finishedAt: 1,
  timeMs: 4200,
  connected: true,
  isHost: true,
};

const friend = {
  id: "friend-1",
  displayName: "Sam",
  progress: 80,
  finishedAt: null,
  timeMs: null,
  connected: true,
  isHost: false,
};

describe("RaceProgressBars overlay", () => {
  beforeEach(() => {
    setActivePage("test");
    setRaceYou(host);
    setIsRaceActive(true);
    setLocalFinished(true);
    setStandings([]);
    setRaceParty({
      code: "ABC123",
      status: "racing",
      hostId: host.id,
      words: ["the", "quick"],
      settings: {
        mode: "words",
        wordCount: 25,
        time: 30,
        punctuation: false,
      },
      players: [host, friend],
      inviteUrl: "https://typeaiapp.vercel.app/race/ABC123",
      startedAt: 1,
      countdownEndsAt: null,
      winnerId: null,
    });
  });

  afterEach(() => {
    cleanup();
    setRaceParty(null);
    setRaceYou(null);
    setIsRaceActive(false);
    setLocalFinished(false);
    setStandings([]);
    setActivePage("loading");
  });

  it("shows a waiting message after you finish the race test", () => {
    const { container } = render(() => <RaceProgressBars testOverlay />);
    expect(container.textContent).toContain(
      "You finished! Waiting for other players…",
    );
  });

  it("shows a race complete standings screen on the test page", () => {
    setRaceParty({
      code: "ABC123",
      status: "finished",
      hostId: host.id,
      words: ["the", "quick"],
      settings: {
        mode: "words",
        wordCount: 25,
        time: 30,
        punctuation: false,
      },
      players: [
        host,
        { ...friend, progress: 100, timeMs: 6100, finishedAt: 2 },
      ],
      inviteUrl: "https://typeaiapp.vercel.app/race/ABC123",
      startedAt: 1,
      countdownEndsAt: null,
      winnerId: host.id,
    });
    setStandings([
      host,
      { ...friend, progress: 100, timeMs: 6100, finishedAt: 2 },
    ]);
    const { container } = render(() => <RaceProgressBars testOverlay />);
    expect(container.textContent).toContain("Race complete");
    expect(container.textContent).toContain("winner");
    expect(container.textContent).toContain("4.20s");
    expect(container.textContent).toContain("Play again");
    expect(container.textContent).not.toContain(
      "You finished! Waiting for other players…",
    );
  });
});
