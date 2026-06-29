import { activeTopEntries, getMistakeProfile } from "./mistake-profile";

const WORD_LIMIT = 140;
const POOL_SAMPLE = 10_000;
const MIN_PATTERN_WORDS = 12;
const PATTERN_SHARE = 0.7;

type ScoredWord = {
  word: string;
  score: number;
};

function sampleWords(words: string[], sampleSize: number): string[] {
  if (words.length <= sampleSize) return words;

  const picked = new Set<number>();
  const out: string[] = [];
  while (out.length < sampleSize && picked.size < words.length) {
    const index = Math.floor(Math.random() * words.length);
    if (picked.has(index)) continue;
    picked.add(index);
    out.push(words[index] ?? "");
  }
  return out;
}

function buildExcludedWords(): Set<string> {
  const profile = getMistakeProfile();
  const excluded = new Set<string>();
  for (const word of activeTopEntries(profile.missedWords, "word", 24)) {
    excluded.add(word.key.toLowerCase());
  }
  return excluded;
}

function scoreWord(word: string, excluded: Set<string>): number {
  const lower = word.toLowerCase();
  if (excluded.has(lower)) return 0;
  if (!/^[a-z]+$/i.test(word)) return 0;

  const profile = getMistakeProfile();
  let score = 0;

  for (const { key, count } of activeTopEntries(
    profile.bigrams,
    "bigram",
    14,
  )) {
    if (lower.includes(key.toLowerCase())) {
      score += count * 3;
    }
  }

  for (const { key, count } of activeTopEntries(
    profile.wrongLetters,
    "letter",
    10,
  )) {
    if (lower.includes(key.toLowerCase())) {
      score += count;
    }
  }

  return score;
}

/** Real dictionary words weighted toward weak bigrams/letters, excluding exact missed words. */
export function buildAdaptivePatternWordList(
  languageWords: string[],
  limit = WORD_LIMIT,
): string[] {
  const excluded = buildExcludedWords();
  const pool = sampleWords(languageWords, POOL_SAMPLE);
  const scored: ScoredWord[] = [];

  for (const word of pool) {
    const score = scoreWord(word, excluded);
    if (score > 0) scored.push({ word, score });
  }

  if (scored.length < MIN_PATTERN_WORDS) return [];

  scored.sort((a, b) => b.score - a.score);

  const patternCount = Math.min(
    Math.ceil(limit * PATTERN_SHARE),
    scored.length,
  );
  const fillerCount = limit - patternCount;

  const patternWords: string[] = [];
  const topCandidates = scored.slice(0, Math.min(scored.length, 80));
  const totalWeight = topCandidates.reduce((sum, item) => sum + item.score, 0);

  while (patternWords.length < patternCount && topCandidates.length > 0) {
    let roll = Math.random() * totalWeight;
    for (const candidate of topCandidates) {
      roll -= candidate.score;
      if (roll <= 0) {
        patternWords.push(candidate.word);
        break;
      }
    }
  }

  const fillerPool = pool.filter(
    (word) =>
      /^[a-z]+$/i.test(word) &&
      !excluded.has(word.toLowerCase()) &&
      scoreWord(word, excluded) === 0,
  );

  const fillerWords: string[] = [];
  while (fillerWords.length < fillerCount && fillerPool.length > 0) {
    const index = Math.floor(Math.random() * fillerPool.length);
    fillerWords.push(fillerPool[index] ?? "");
  }

  return [...patternWords, ...fillerWords].sort(() => Math.random() - 0.5);
}
