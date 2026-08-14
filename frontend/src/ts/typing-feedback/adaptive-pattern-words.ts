import { activeTopEntries, getMistakeProfile } from "./mistake-profile";

const WORD_LIMIT = 140;
const POOL_LIMIT = 8_000;
const MIN_PATTERN_WORDS = 8;
const MISSED_MIN_REPS = 2;
const MISSED_MAX_REPS = 5;
const VOWELS = new Set(["a", "e", "i", "o", "u"]);
const COMMON_WORDS = new Set([
  "the",
  "a",
  "an",
  "to",
  "of",
  "in",
  "and",
  "is",
  "it",
  "for",
  "on",
  "with",
  "as",
  "at",
  "by",
  "be",
  "or",
  "from",
  "that",
  "this",
  "was",
  "are",
]);

type ScoredWord = {
  word: string;
  score: number;
};

function missedReps(count: number): number {
  return Math.min(MISSED_MAX_REPS, Math.max(MISSED_MIN_REPS, count));
}

function pickWeightedWithoutReplacement(
  candidates: ScoredWord[],
  count: number,
): string[] {
  const pool = [...candidates];
  const out: string[] = [];

  while (out.length < count && pool.length > 0) {
    const totalWeight = pool.reduce((sum, item) => sum + item.score, 0);
    if (totalWeight <= 0) break;

    let roll = Math.random() * totalWeight;
    let pickedIndex = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      roll -= pool[i]?.score ?? 0;
      if (roll <= 0) {
        pickedIndex = i;
        break;
      }
    }

    const picked = pool.splice(pickedIndex, 1)[0];
    if (picked !== undefined) out.push(picked.word);
  }

  return out;
}

/**
 * Dictionary words weighted toward weak bigrams/letters and actual misses.
 * Missed words are included (not excluded). Easy unmatched filler is not added,
 * so adaptive should feel slower than original — not a repeat of common words.
 */
export function buildAdaptivePatternWordList(
  languageWords: string[],
  limit = WORD_LIMIT,
): string[] {
  const profile = getMistakeProfile();
  const missed = activeTopEntries(profile.missedWords, "word", 16);
  const bigrams = activeTopEntries(profile.bigrams, "bigram", 14);
  const letters = activeTopEntries(profile.wrongLetters, "letter", 10);
  const missedCounts = new Map(
    missed.map((entry) => [entry.key.toLowerCase(), entry.count]),
  );

  const pool = languageWords.slice(
    0,
    Math.min(languageWords.length, POOL_LIMIT),
  );
  const scored: ScoredWord[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < pool.length; index++) {
    const word = pool[index];
    if (word === undefined || !/^[a-z]+$/i.test(word)) continue;

    const lower = word.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);

    let score = 0;
    const missedCount = missedCounts.get(lower) ?? 0;
    if (missedCount > 0) score += missedCount * 12;

    for (const { key, count } of bigrams) {
      if (lower.includes(key.toLowerCase())) score += count * 3;
    }

    for (const { key, count } of letters) {
      if (!lower.includes(key.toLowerCase())) continue;
      score += VOWELS.has(key.toLowerCase()) ? count * 0.4 : count * 1.5;
    }

    if (score <= 0) continue;

    const rarity = 1 + index / 400;
    const lengthBonus = 1 + Math.max(0, word.length - 4) * 0.12;
    if (COMMON_WORDS.has(lower) && missedCount === 0) score *= 0.2;
    scored.push({ word, score: score * rarity * lengthBonus });
  }

  for (const { key, count } of missed) {
    const lower = key.toLowerCase();
    if (seen.has(lower) || !/^[a-z]+$/i.test(key)) continue;
    scored.push({ word: key, score: count * 12 });
    seen.add(lower);
  }

  if (scored.length < MIN_PATTERN_WORDS) return [];

  scored.sort((a, b) => b.score - a.score);

  const words: string[] = [];
  for (const { key, count } of missed) {
    if (!/^[a-z]+$/i.test(key)) continue;
    for (let i = 0; i < missedReps(count); i++) {
      words.push(key);
    }
  }

  const remaining = Math.max(0, limit - words.length);
  const uniqueFill = pickWeightedWithoutReplacement(
    scored.slice(0, Math.min(scored.length, 120)),
    remaining,
  );

  return [...words, ...uniqueFill]
    .slice(0, limit)
    .sort(() => Math.random() - 0.5);
}
