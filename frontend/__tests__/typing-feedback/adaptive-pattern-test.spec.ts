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

  it("returns real words with weak patterns and excludes exact missed words", () => {
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
    expect(words).not.toContain("the");
    expect(words).not.toContain("their");
    expect(words.some((word) => word.includes("th"))).toBe(true);
    expect(words.every((word) => /^[a-z]+$/i.test(word))).toBe(true);
  });
});
