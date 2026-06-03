/** In-memory mistake data for the current test (merged into profile when a test completes). */

export type SessionMistakeSnapshot = {
  wrongLetters: Record<string, number>;
  typedInstead: Record<string, number>;
  bigrams: Record<string, number>;
  missedWords: Record<string, number>;
};

let wrongLetters: Record<string, number> = {};
let typedInstead: Record<string, number> = {};
let bigrams: Record<string, number> = {};
let missedWords: Record<string, number> = {};

function bump(map: Record<string, number>, key: string): void {
  if (key.length === 0) return;
  map[key] = (map[key] ?? 0) + 1;
}

export function recordKeyMistake(
  expectedChar: string,
  typedChar: string,
  previousExpectedChar?: string,
): void {
  if (!expectedChar) return;
  bump(wrongLetters, expectedChar.toLowerCase());
  if (typedChar && typedChar !== expectedChar) {
    bump(
      typedInstead,
      `${typedChar.toLowerCase()}→${expectedChar.toLowerCase()}`,
    );
  }
  if (previousExpectedChar !== undefined && previousExpectedChar.length > 0) {
    const pair = `${previousExpectedChar.toLowerCase()}${expectedChar.toLowerCase()}`;
    bump(bigrams, pair);
  }
}

export function recordMissedWord(word: string): void {
  const normalized = word.replace(/[.?!":\-,']/g, "").toLowerCase();
  if (normalized.length === 0) return;
  bump(missedWords, normalized);
}

export function mergeMissedWordsFromInput(words: Record<string, number>): void {
  for (const [word, count] of Object.entries(words)) {
    for (let i = 0; i < count; i++) {
      recordMissedWord(word);
    }
  }
}

export function getSessionMistakeSnapshot(): SessionMistakeSnapshot {
  return {
    wrongLetters: { ...wrongLetters },
    typedInstead: { ...typedInstead },
    bigrams: { ...bigrams },
    missedWords: { ...missedWords },
  };
}

export function hasSessionMistakes(): boolean {
  return (
    Object.keys(wrongLetters).length > 0 ||
    Object.keys(bigrams).length > 0 ||
    Object.keys(missedWords).length > 0
  );
}

export function resetSessionMistakes(): void {
  wrongLetters = {};
  typedInstead = {};
  bigrams = {};
  missedWords = {};
}
