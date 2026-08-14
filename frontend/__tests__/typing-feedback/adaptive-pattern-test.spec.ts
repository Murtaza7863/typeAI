import { describe, expect, it, vi, beforeEach } from "vitest";

import { buildAdaptivePatternWordList } from "../../src/ts/typing-feedback/adaptive-pattern-words";
import * as MistakeProfile from "../../src/ts/typing-feedback/mistake-profile";

describe("buildAdaptivePatternWordList", () => {
  beforeEach(() => {
    vi.spyOn(MistakeProfile, "getMistakeProfile").mockReturnValue({
      wrongLetters: { e: 4 },
      typedInstead: {},
      bigrams: { th: 6 },
      missedWords: { the: 5, their: 3 },
      weakLetterScores: {},
      cleanStreaks: {},
      recovered: [],
      testsRecorded: 3,
      updatedAt: Date.now(),
    });
  });

  it("includes missed words and other weak-pattern words, not easy filler", () => {
    const languageWords = [
      "the",
      "their",
      "other",
      "mother",
      "brother",
      "weather",
      "apple",
      "banana",
      "theme",
      "thick",
      "thin",
      "path",
      "math",
      "bath",
      "hello",
      "world",
    ];

    const words = buildAdaptivePatternWordList(languageWords, 20);

    expect(words.length).toBeGreaterThan(0);
    expect(words).toContain("the");
    expect(words).toContain("their");
    expect(words.some((word) => word.includes("th"))).toBe(true);
    expect(words.every((word) => /^[a-z]+$/i.test(word))).toBe(true);
    expect(words).not.toContain("banana");
    expect(words).not.toContain("world");
  });

  it("does not repeat non-missed pattern words", () => {
    const languageWords = [
      "other",
      "mother",
      "brother",
      "weather",
      "theme",
      "thick",
      "thin",
      "path",
      "math",
      "bath",
      "together",
      "thought",
      "the",
      "their",
    ];

    const words = buildAdaptivePatternWordList(languageWords, 40);
    const counts = new Map<string, number>();
    for (const word of words) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }

    for (const [word, count] of counts) {
      if (word === "the" || word === "their") continue;
      expect(count).toBe(1);
    }
  });
});
