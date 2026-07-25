import { afterEach, describe, expect, it } from "vitest";
import { CompletedEvent } from "@typeai/schemas/results";

const memory = new Map<string, string>();
const localStorageMock = {
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
  value: localStorageMock,
});
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: localStorageMock,
});

const { buildDailyGoals, DAILY_GOALS, getLocalStreak, recordDailyProgress } =
  await import("../../src/ts/utils/result-progress");

function makeResult(overrides: Partial<CompletedEvent> = {}): CompletedEvent {
  return {
    wpm: 60,
    rawWpm: 65,
    charStats: [100, 0, 0, 0],
    acc: 98,
    mode: "time",
    mode2: 15,
    quoteLength: -1,
    consistency: 80,
    keyConsistency: 80,
    chartData: { wpm: [], raw: [], err: [] },
    testDuration: 15,
    incompleteTestSeconds: 0,
    afkDuration: 0,
    timestamp: Date.UTC(2026, 6, 25, 15, 0, 0),
    language: "english",
    difficulty: "normal",
    ...overrides,
  } as CompletedEvent;
}

describe("daily quests / progress", () => {
  afterEach(() => {
    memory.clear();
  });

  it("tracks tests, drills, and celebrates when all goals complete", () => {
    const first = recordDailyProgress(makeResult(), { coachMode: "original" });
    expect(first.day.tests).toBe(1);
    expect(first.day.drills).toBe(0);
    expect(first.justCompletedAllGoals).toBe(false);

    recordDailyProgress(makeResult({ wpm: 62 }), { coachMode: "drill" });
    const almost = recordDailyProgress(
      makeResult({
        testDuration: DAILY_GOALS.seconds,
        incompleteTestSeconds: 0,
        afkDuration: 0,
      }),
      { coachMode: "adaptive" },
    );

    expect(almost.day.tests).toBe(3);
    expect(almost.day.drills).toBe(2);
    expect(almost.day.seconds).toBeGreaterThanOrEqual(DAILY_GOALS.seconds);
    expect(almost.justCompletedAllGoals).toBe(true);

    const goals = buildDailyGoals(almost.day);
    expect(goals.every((goal) => goal.complete)).toBe(true);

    const again = recordDailyProgress(makeResult(), { coachMode: "drill" });
    expect(again.justCompletedAllGoals).toBe(false);
  });

  it("counts local streak across consecutive days", () => {
    const day1 = Date.UTC(2026, 6, 23, 12, 0, 0);
    const day2 = Date.UTC(2026, 6, 24, 12, 0, 0);
    const day3 = Date.UTC(2026, 6, 25, 12, 0, 0);

    recordDailyProgress(makeResult({ timestamp: day1 }));
    recordDailyProgress(makeResult({ timestamp: day2 }));
    recordDailyProgress(makeResult({ timestamp: day3 }));

    expect(getLocalStreak(day3)).toBe(3);
  });
});
