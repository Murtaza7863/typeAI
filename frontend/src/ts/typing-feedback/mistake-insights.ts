import {
  activeTopEntries,
  getMistakeProfile,
  getRecentRecoveries,
  getRecoveryProgressSummary,
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

  const letters = activeTopEntries(profile.wrongLetters, "letter", 5);
  if (letters.length > 0) {
    out.push({
      issue: "Letters you miss most often",
      evidence: formatLetterList(letters),
      fix: "Slow down on words containing these letters. Type them in isolation 20 times before your next speed run.",
    });
  }

  const bigrams = activeTopEntries(profile.bigrams, "bigram", 5);
  if (bigrams.length > 0) {
    const combos = bigrams.map((b) => `"${b.key}"`).join(", ");
    out.push({
      issue: "Key combinations that trip you up",
      evidence: `Frequent errors on pairs: ${combos}.`,
      fix: `Drill these pairs as syllables (e.g. ${bigrams[0]?.key ?? "th"} in short words) at 70% of your max WPM until they feel automatic.`,
    });
  }

  const swaps = activeTopEntries(profile.typedInstead, "swap", 4);
  if (swaps.length > 0) {
    out.push({
      issue: "Common wrong-key substitutions",
      evidence: swaps.map((s) => `${s.key} (${s.count}×)`).join("; "),
      fix: "When you feel a finger slip, pause and re-type the syllable instead of correcting mid-word.",
    });
  }

  const words = activeTopEntries(profile.missedWords, "word", 5);
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

export function recoveryStrengthsFromProfile(): string[] {
  const strengths: string[] = [];
  const summary = getRecoveryProgressSummary();
  if (summary !== null && summary.length > 0) strengths.push(summary);

  const recent = getRecentRecoveries(5);
  const inProgress = Object.entries(getMistakeProfile().cleanStreaks).filter(
    ([, streak]) => streak === 1,
  );
  if (inProgress.length > 0) {
    const keys = inProgress
      .slice(0, 3)
      .map(([sk]) => sk.split(":")[1] ?? sk)
      .join(", ");
    strengths.push(
      `Almost there: clean streak building on ${keys}—one more accurate test may clear them from your weak list.`,
    );
  }

  if (recent.length > 0 && strengths.length === 0) {
    strengths.push(
      `${recent.length} weakness${recent.length === 1 ? "" : "es"} faded after consistent clean tests—keep it up.`,
    );
  }

  return strengths;
}

export function profileInsightSummary(profile = getMistakeProfile()): string {
  if (profile.testsRecorded === 0) return "";
  const parts: string[] = [];
  const letters = activeTopEntries(profile.wrongLetters, "letter", 1)[0];
  const bigrams = activeTopEntries(profile.bigrams, "bigram", 1)[0];
  const words = activeTopEntries(profile.missedWords, "word", 1)[0];
  if (letters) parts.push(`letter "${letters.key}"`);
  if (bigrams) parts.push(`combo "${bigrams.key}"`);
  if (words) parts.push(`word "${words.key}"`);
  const recovery = getRecoveryProgressSummary();
  if (parts.length === 0 && recovery !== null && recovery.length > 0) {
    return recovery;
  }
  if (parts.length === 0) return "";
  const base = `Tracked across ${profile.testsRecorded} tests — focus: ${parts.join(", ")}.`;
  return recovery !== null && recovery.length > 0
    ? `${base} ${recovery}`
    : base;
}
