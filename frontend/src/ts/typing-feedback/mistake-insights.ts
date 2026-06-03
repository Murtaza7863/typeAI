import {
  getMistakeProfile,
  topEntries,
  type MistakeProfile,
} from "./mistake-profile";
import { TypingFeedbackMistake } from "@typeai/schemas/typing-feedback";

export function formatLetterList(
  entries: { key: string; count: number }[],
): string {
  if (entries.length === 0) return "";
  return entries.map((e) => `"${e.key}" (${e.count}×)`).join(", ");
}

export function mistakesFromProfile(
  profile: MistakeProfile,
): TypingFeedbackMistake[] {
  const out: TypingFeedbackMistake[] = [];

  const letters = topEntries(profile.wrongLetters, 5);
  if (letters.length > 0) {
    out.push({
      issue: "Letters you miss most often",
      evidence: formatLetterList(letters),
      fix: "Slow down on words containing these letters. Type them in isolation 20 times before your next speed run.",
    });
  }

  const bigrams = topEntries(profile.bigrams, 5);
  if (bigrams.length > 0) {
    const combos = bigrams.map((b) => `"${b.key}"`).join(", ");
    out.push({
      issue: "Key combinations that trip you up",
      evidence: `Frequent errors on pairs: ${combos}.`,
      fix: `Drill these pairs as syllables (e.g. ${bigrams[0]?.key ?? "th"} in short words) at 70% of your max WPM until they feel automatic.`,
    });
  }

  const swaps = topEntries(profile.typedInstead, 4);
  if (swaps.length > 0) {
    out.push({
      issue: "Common wrong-key substitutions",
      evidence: swaps.map((s) => `${s.key} (${s.count}×)`).join("; "),
      fix: "When you feel a finger slip, pause and re-type the syllable instead of correcting mid-word.",
    });
  }

  const words = topEntries(profile.missedWords, 5);
  if (words.length > 0) {
    out.push({
      issue: "Words you stumble on repeatedly",
      evidence: words.map((w) => `"${w.key}" (${w.count}×)`).join(", "),
      fix: "Use “Practice words” or the adaptive next test to repeat these words until accuracy is above 98%.",
    });
  }

  const weak = topEntries(profile.weakLetterScores, 4);
  if (weak.length > 0 && letters.length === 0) {
    out.push({
      issue: "Slow or hesitant key timing",
      evidence: `Highest hesitation scores on: ${weak.map((w) => w.key).join(", ")}.`,
      fix: "Run 30s accuracy tests focusing on rhythm on those keys before increasing speed.",
    });
  }

  return out;
}

export function profileInsightSummary(profile = getMistakeProfile()): string {
  if (profile.testsRecorded === 0) return "";
  const parts: string[] = [];
  const letters = topEntries(profile.wrongLetters, 1)[0];
  const bigrams = topEntries(profile.bigrams, 1)[0];
  const words = topEntries(profile.missedWords, 1)[0];
  if (letters) parts.push(`letter "${letters.key}"`);
  if (bigrams) parts.push(`combo "${bigrams.key}"`);
  if (words) parts.push(`word "${words.key}"`);
  if (parts.length === 0) return "";
  return `Tracked across ${profile.testsRecorded} tests — weakest spots: ${parts.join(", ")}.`;
}
