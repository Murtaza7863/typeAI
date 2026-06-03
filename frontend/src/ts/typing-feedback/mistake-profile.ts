import type { SessionMistakeSnapshot } from "./session-mistakes";

const STORAGE_KEY = "typeai-mistake-profile";
const MAX_ENTRIES = 40;

export type MistakeProfile = {
  wrongLetters: Record<string, number>;
  typedInstead: Record<string, number>;
  bigrams: Record<string, number>;
  missedWords: Record<string, number>;
  weakLetterScores: Record<string, number>;
  testsRecorded: number;
  updatedAt: number;
};

function emptyProfile(): MistakeProfile {
  return {
    wrongLetters: {},
    typedInstead: {},
    bigrams: {},
    missedWords: {},
    weakLetterScores: {},
    testsRecorded: 0,
    updatedAt: Date.now(),
  };
}

function trimCounts(
  target: Record<string, number>,
  cap: number,
): Record<string, number> {
  const keys = Object.keys(target);
  if (keys.length <= cap) return target;
  const sorted = keys.sort((a, b) => (target[b] ?? 0) - (target[a] ?? 0));
  const trimmed: Record<string, number> = {};
  for (const key of sorted.slice(0, cap)) {
    trimmed[key] = target[key] ?? 0;
  }
  return trimmed;
}

function mergeCountMaps(
  base: Record<string, number>,
  source: Record<string, number>,
  cap = MAX_ENTRIES,
): Record<string, number> {
  const merged = { ...base };
  for (const [key, count] of Object.entries(source)) {
    merged[key] = (merged[key] ?? 0) + count;
  }
  return trimCounts(merged, cap);
}

export function getMistakeProfile(): MistakeProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null || raw === "") return emptyProfile();
    const parsed = JSON.parse(raw) as MistakeProfile;
    return { ...emptyProfile(), ...parsed };
  } catch {
    return emptyProfile();
  }
}

export function recordSessionToProfile(
  snapshot: SessionMistakeSnapshot,
  weakLetterScores?: Record<string, number>,
): void {
  const profile = getMistakeProfile();
  profile.wrongLetters = mergeCountMaps(
    profile.wrongLetters,
    snapshot.wrongLetters,
  );
  profile.typedInstead = mergeCountMaps(
    profile.typedInstead,
    snapshot.typedInstead,
  );
  profile.bigrams = mergeCountMaps(profile.bigrams, snapshot.bigrams);
  profile.missedWords = mergeCountMaps(
    profile.missedWords,
    snapshot.missedWords,
  );

  if (weakLetterScores) {
    const mergedWeak = { ...profile.weakLetterScores };
    for (const [letter, score] of Object.entries(weakLetterScores)) {
      mergedWeak[letter] = Math.max(mergedWeak[letter] ?? 0, score);
    }
    profile.weakLetterScores = trimCounts(mergedWeak, MAX_ENTRIES);
  }

  profile.testsRecorded += 1;
  profile.updatedAt = Date.now();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

export function clearMistakeProfile(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function profileHasDrillData(profile = getMistakeProfile()): boolean {
  return (
    Object.keys(profile.wrongLetters).length > 0 ||
    Object.keys(profile.bigrams).length > 0 ||
    Object.keys(profile.missedWords).length > 0
  );
}

export function topEntries(
  map: Record<string, number>,
  limit = 5,
): { key: string; count: number }[] {
  return Object.entries(map)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
