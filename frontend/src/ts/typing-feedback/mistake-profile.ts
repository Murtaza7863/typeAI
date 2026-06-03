import type { SessionMistakeSnapshot } from "./session-mistakes";

const STORAGE_KEY = "typeai-mistake-profile";
const MAX_ENTRIES = 40;
const MAX_RECOVERED_LOG = 25;
/** Clean tests without a weakness before we decay its count. */
const CLEAN_SESSIONS_TO_RECOVER = 2;
const DECAY_FACTOR = 0.45;
const MIN_COUNT_AFTER_DECAY = 1;

export type RecoveryEntry = {
  key: string;
  kind: "letter" | "bigram" | "word" | "swap";
  at: number;
  wasCount: number;
};

export type MistakeProfile = {
  wrongLetters: Record<string, number>;
  typedInstead: Record<string, number>;
  bigrams: Record<string, number>;
  missedWords: Record<string, number>;
  weakLetterScores: Record<string, number>;
  /** Consecutive clean tests per tracked weakness (e.g. L:e, B:th). */
  cleanStreaks: Record<string, number>;
  recovered: RecoveryEntry[];
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
    cleanStreaks: {},
    recovered: [],
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

function streakKey(kind: RecoveryEntry["kind"], key: string): string {
  return `${kind[0]?.toUpperCase()}:${key}`;
}

function removeKey(
  map: Record<string, number>,
  key: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(map)) {
    if (k !== key) out[k] = v;
  }
  return out;
}

function setMapForKind(
  profile: MistakeProfile,
  kind: RecoveryEntry["kind"],
  map: Record<string, number>,
): void {
  if (kind === "letter") profile.wrongLetters = map;
  else if (kind === "bigram") profile.bigrams = map;
  else if (kind === "word") profile.missedWords = map;
  else profile.typedInstead = map;
}

function decayWeakness(
  profile: MistakeProfile,
  key: string,
  kind: RecoveryEntry["kind"],
): void {
  const map =
    kind === "letter"
      ? profile.wrongLetters
      : kind === "bigram"
        ? profile.bigrams
        : kind === "word"
          ? profile.missedWords
          : profile.typedInstead;
  const current = map[key] ?? 0;
  if (current <= 0) return;

  const next = Math.floor(current * DECAY_FACTOR);
  const sk = streakKey(kind, key);

  if (next <= MIN_COUNT_AFTER_DECAY) {
    const wasCount = current;
    setMapForKind(profile, kind, removeKey(map, key));
    profile.recovered = [
      { key, kind, at: Date.now(), wasCount },
      ...profile.recovered,
    ].slice(0, MAX_RECOVERED_LOG);
    const streakRest = { ...profile.cleanStreaks };
    const nextStreaks: Record<string, number> = {};
    for (const [k, v] of Object.entries(streakRest)) {
      if (k !== sk) nextStreaks[k] = v;
    }
    profile.cleanStreaks = nextStreaks;
  } else {
    map[key] = next;
    profile.cleanStreaks[sk] = 0;
  }
}

function applyRecoveryTracking(
  profile: MistakeProfile,
  snapshot: SessionMistakeSnapshot,
): void {
  const track = (
    map: Record<string, number>,
    sessionMap: Record<string, number>,
    kind: RecoveryEntry["kind"],
  ): void => {
    for (const key of Object.keys(map)) {
      if ((map[key] ?? 0) < 2) continue;
      const sk = streakKey(kind, key);
      const hadError = (sessionMap[key] ?? 0) > 0;

      if (hadError) {
        profile.cleanStreaks[sk] = 0;
      } else {
        const streak = (profile.cleanStreaks[sk] ?? 0) + 1;
        profile.cleanStreaks[sk] = streak;
        if (streak >= CLEAN_SESSIONS_TO_RECOVER) {
          decayWeakness(profile, key, kind);
        }
      }
    }
  };

  track(profile.wrongLetters, snapshot.wrongLetters, "letter");
  track(profile.bigrams, snapshot.bigrams, "bigram");
  track(profile.missedWords, snapshot.missedWords, "word");
  track(profile.typedInstead, snapshot.typedInstead, "swap");
}

export function getMistakeProfile(): MistakeProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null || raw === "") return emptyProfile();
    const parsed = JSON.parse(raw) as Partial<MistakeProfile>;
    return {
      ...emptyProfile(),
      ...parsed,
      cleanStreaks: parsed.cleanStreaks ?? {},
      recovered: parsed.recovered ?? [],
    };
  } catch {
    return emptyProfile();
  }
}

export function recordSessionToProfile(
  snapshot: SessionMistakeSnapshot,
  weakLetterScores?: Record<string, number>,
): void {
  const profile = getMistakeProfile();

  applyRecoveryTracking(profile, snapshot);

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
    Object.keys(profile.missedWords).length > 0 ||
    Object.keys(profile.typedInstead).length > 0
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

/** Active weaknesses only (excludes recently recovered with low counts). */
export function activeTopEntries(
  map: Record<string, number>,
  kind: RecoveryEntry["kind"],
  limit = 5,
): { key: string; count: number }[] {
  const profile = getMistakeProfile();
  const recoveredKeys = new Set(
    profile.recovered
      .filter(
        (r) => r.kind === kind && Date.now() - r.at < 14 * 24 * 60 * 60 * 1000,
      )
      .map((r) => r.key),
  );

  return topEntries(map, limit * 2)
    .filter((e) => e.count >= 2 && !recoveredKeys.has(e.key))
    .slice(0, limit);
}

export function getRecentRecoveries(limit = 5): RecoveryEntry[] {
  return getMistakeProfile().recovered.slice(0, limit);
}

export function getRecoveryProgressSummary(): string | null {
  const profile = getMistakeProfile();
  const recent = profile.recovered.filter(
    (r) => Date.now() - r.at < 7 * 24 * 60 * 60 * 1000,
  );
  if (recent.length === 0) return null;

  const labels = recent.slice(0, 3).map((r) => {
    if (r.kind === "bigram") return `"${r.key}"`;
    if (r.kind === "word") return `"${r.key}"`;
    if (r.kind === "swap") return r.key;
    return `letter "${r.key}"`;
  });

  return `Recently improved on ${labels.join(", ")} after clean tests.`;
}
