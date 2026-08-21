import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RacePartyState, RaceServerMessage } from "@typeai/schemas/race";

const { memory } = vi.hoisted(() => {
  const memory = new Map<string, string>();
  const webStorage = {
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
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: webStorage,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: webStorage,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: webStorage,
    });
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: webStorage,
    });
  }
  return { memory };
});

let raceMessage: ((message: RaceServerMessage) => void) | undefined;

vi.mock("../../src/ts/race/client", () => ({
  onRaceMessage: (cb: (message: RaceServerMessage) => void) => {
    raceMessage = cb;
    return () => {
      raceMessage = undefined;
    };
  },
  sendProgress: vi.fn(),
  sendFinished: vi.fn(),
  leaveParty: vi.fn(),
  leaveRaceOnPageHide: vi.fn(),
}));

import { sendFinished, sendProgress } from "../../src/ts/race/client";
import {
  initRaceController,
  reportRaceFinished,
  restoreAfterRace,
} from "../../src/ts/race/controller";
import { setActivePage } from "../../src/ts/states/core";
import {
  setIsRaceActive,
  setLocalFinished,
  setRaceParty,
  setRaceStartedAt,
} from "../../src/ts/states/race";
import * as CustomText from "../../src/ts/test/custom-text";

const words = Array.from({ length: 25 }, (_, i) => `word${i}`);
const timedWords = Array.from({ length: 200 }, (_, i) => `t${i}`);

function racingParty(mode: "words" | "time"): RacePartyState {
  return {
    code: "ABC123",
    status: "racing",
    hostId: "host-1",
    words: mode === "time" ? timedWords : words,
    settings: {
      mode,
      wordCount: 25,
      time: 15,
      punctuation: false,
    },
    players: [],
    inviteUrl: "https://typeaiapp.vercel.app/race/ABC123",
    startedAt: 1,
    countdownEndsAt: null,
    winnerId: null,
  };
}

describe("race finish for words and time", () => {
  beforeEach(() => {
    memory.clear();
    vi.clearAllMocks();
    vi.useFakeTimers();
    setActivePage("race");
    setLocalFinished(false);
    setIsRaceActive(false);
    setRaceStartedAt(null);
    setRaceParty(null);
    initRaceController();
  });

  afterEach(() => {
    restoreAfterRace();
    setRaceParty(null);
    vi.useRealTimers();
  });

  it("ends a words race when the shared word list is complete", () => {
    raceMessage?.({
      type: "raceStart",
      startedAt: 1000,
      words,
      settings: {
        mode: "words",
        wordCount: 25,
        time: 30,
        punctuation: false,
      },
    });
    expect(CustomText.getLimitMode()).toBe("word");
    expect(CustomText.getLimitValue()).toBe(25);

    setRaceParty(racingParty("words"));
    setIsRaceActive(true);
    setLocalFinished(false);
    setRaceStartedAt(1000);
    reportRaceFinished();
    expect(sendProgress).toHaveBeenCalledWith(100);
    expect(sendFinished).toHaveBeenCalled();
  });

  it("ends a timed race on the clock instead of the 200-word list", () => {
    raceMessage?.({
      type: "raceStart",
      startedAt: 1000,
      words: timedWords,
      settings: {
        mode: "time",
        wordCount: 25,
        time: 15,
        punctuation: false,
      },
    });
    expect(CustomText.getLimitMode()).toBe("time");
    expect(CustomText.getLimitValue()).toBe(15);

    setRaceParty(racingParty("time"));
    setIsRaceActive(true);
    setLocalFinished(false);
    setRaceStartedAt(1000);
    reportRaceFinished();
    expect(sendProgress).not.toHaveBeenCalled();
    expect(sendFinished).toHaveBeenCalled();
  });
});
