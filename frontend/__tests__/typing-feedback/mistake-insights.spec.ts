import { afterEach, describe, expect, it } from "vitest";

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

const { recordSessionToProfile, clearMistakeProfile } =
  await import("../../src/ts/typing-feedback/mistake-profile");
const { getCoachProgress, mistakesFromProfile, profileInsightSummary } =
  await import("../../src/ts/typing-feedback/mistake-insights");
const { getMistakeProfile } =
  await import("../../src/ts/typing-feedback/mistake-profile");

describe("coach writeup from mistake profile", () => {
  afterEach(() => {
    memory.clear();
    clearMistakeProfile();
  });

  it("names letters, pairs, and words in the writeup", () => {
    recordSessionToProfile({
      wrongLetters: { e: 2 },
      typedInstead: {},
      bigrams: { th: 3 },
      missedWords: { their: 2 },
    });
    recordSessionToProfile({
      wrongLetters: { e: 2 },
      typedInstead: {},
      bigrams: { th: 2 },
      missedWords: { their: 2 },
    });

    const mistakes = mistakesFromProfile(getMistakeProfile());
    const issues = mistakes.map((m) => m.issue).join(" ");
    const evidence = mistakes.map((m) => m.evidence).join(" ");

    expect(issues).toContain('"e"');
    expect(issues).toContain('"th"');
    expect(evidence).toContain("their");

    const summary = profileInsightSummary();
    expect(summary).toContain('letter "e"');
    expect(summary).toContain('combo "th"');
    expect(summary).toContain("their");

    const progress = getCoachProgress();
    expect(progress.active.some((item) => item.includes("e"))).toBe(true);
    expect(progress.active.some((item) => item.includes("th"))).toBe(true);
  });
});
