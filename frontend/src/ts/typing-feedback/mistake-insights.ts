import {
  activeTopEntries,
  getMistakeProfile,
  getRecentRecoveries,
  getRecoveryProgressSummary,
  topEntries,
  type MistakeProfile,
} from "./mistake-profile";
import { TypingFeedbackMistake } from "@typeai/schemas/typing-feedback";

function formatLetterList(entries: { key: string; count: number }[]): string {
  if (entries.length === 0) return "";
  return entries.map((e) => `"${e.key}" (${e.count}×)`).join(", ");
}

function formatWeaknessKey(
  kind: "letter" | "bigram" | "word" | "swap",
  key: string,
): string {
  if (kind === "bigram") return `combo "${key}"`;
  if (kind === "word") return `"${key}"`;
  if (kind === "swap") return key;
  return `letter "${key}"`;
}

export function mistakesFromProfile(
  profile: MistakeProfile,
): TypingFeedbackMistake[] {
  const out: TypingFeedbackMistake[] = [];

  const letters = activeTopEntries(profile.wrongLetters, "letter", 5);
  if (letters.length > 0) {
    const top = letters[0];
    out.push({
      issue:
        top === undefined
          ? "Letters you miss most often"
          : `You keep missing "${top.key}"`,
      evidence: formatLetterList(letters),
      fix: `Slow down on words that contain ${letters.map((e) => `"${e.key}"`).join(", ")}. Adaptive will bias the next test toward those letters.`,
      practiceKind: "letters",
    });
  }

  const bigrams = activeTopEntries(profile.bigrams, "bigram", 5);
  if (bigrams.length > 0) {
    const combos = bigrams.map((b) => `"${b.key}"`).join(", ");
    const top = bigrams[0]?.key ?? "th";
    out.push({
      issue: `The "${top}" pair is tripping you up`,
      evidence: `Frequent errors on pairs: ${combos}.`,
      fix: `Drill "${top}" as a syllable in short words at ~70% of your max WPM, then switch to Adaptive so those pairs show up in real words.`,
      practiceKind: "bigrams",
    });
  }

  const swaps = activeTopEntries(profile.typedInstead, "swap", 4);
  if (swaps.length > 0) {
    out.push({
      issue: "Common wrong-key substitutions",
      evidence: swaps.map((s) => `${s.key} (${s.count}×)`).join("; "),
      fix: "When you feel a finger slip, pause and re-type the syllable instead of correcting mid-word.",
      practiceKind: "swaps",
    });
  }

  const words = activeTopEntries(profile.missedWords, "word", 5);
  if (words.length > 0) {
    const listed = words.map((w) => `"${w.key}"`).join(", ");
    out.push({
      issue: "Words you stumble on repeatedly",
      evidence: words.map((w) => `"${w.key}" (${w.count}×)`).join(", "),
      fix: `These will repeat in Adaptive. Or hit Practice to drill ${listed} until they feel automatic.`,
      practiceKind: "words",
    });
  }

  const weak = topEntries(profile.weakLetterScores, 4);
  if (weak.length > 0 && letters.length === 0) {
    out.push({
      issue: "Slow or hesitant key timing",
      evidence: `Highest hesitation scores on: ${weak.map((w) => w.key).join(", ")}.`,
      fix: "Run 30s accuracy tests focusing on rhythm on those keys before increasing speed.",
      practiceKind: "timing",
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
      .map(([sk]) => {
        const [kind, key] = sk.split(":");
        if (kind === "B") return formatWeaknessKey("bigram", key ?? sk);
        if (kind === "W") return formatWeaknessKey("word", key ?? sk);
        if (kind === "S") return formatWeaknessKey("swap", key ?? sk);
        return formatWeaknessKey("letter", key ?? sk);
      })
      .join(", ");
    strengths.push(`Almost there: one more clean test may clear ${keys}.`);
  }

  if (recent.length > 0 && strengths.length === 0) {
    strengths.push(
      `${recent.length} weakness${recent.length === 1 ? "" : "es"} faded after consistent clean tests—keep it up.`,
    );
  }

  return strengths;
}

export function getCoachProgress(): {
  recovered: string[];
  active: string[];
  almost: string[];
} {
  const profile = getMistakeProfile();
  const recovered = profile.recovered
    .filter((r) => Date.now() - r.at < 7 * 24 * 60 * 60 * 1000)
    .slice(0, 5)
    .map((r) => formatWeaknessKey(r.kind, r.key));

  const active = [
    ...activeTopEntries(profile.wrongLetters, "letter", 3).map((e) =>
      formatWeaknessKey("letter", e.key),
    ),
    ...activeTopEntries(profile.bigrams, "bigram", 3).map((e) =>
      formatWeaknessKey("bigram", e.key),
    ),
    ...activeTopEntries(profile.missedWords, "word", 3).map((e) =>
      formatWeaknessKey("word", e.key),
    ),
  ];

  const almost = Object.entries(profile.cleanStreaks)
    .filter(([, streak]) => streak === 1)
    .slice(0, 3)
    .map(([sk]) => {
      const [kind, key] = sk.split(":");
      if (kind === "B") return formatWeaknessKey("bigram", key ?? sk);
      if (kind === "W") return formatWeaknessKey("word", key ?? sk);
      if (kind === "S") return formatWeaknessKey("swap", key ?? sk);
      return formatWeaknessKey("letter", key ?? sk);
    });

  return { recovered, active, almost };
}

export function profileInsightSummary(profile = getMistakeProfile()): string {
  if (profile.testsRecorded === 0) return "";
  const parts: string[] = [];
  const letters = activeTopEntries(profile.wrongLetters, "letter", 1)[0];
  const bigrams = activeTopEntries(profile.bigrams, "bigram", 1)[0];
  const words = activeTopEntries(profile.missedWords, "word", 1)[0];
  if (letters) parts.push(`letter "${letters.key}"`);
  if (bigrams) parts.push(`combo "${bigrams.key}"`);
  if (words) parts.push(`the word "${words.key}"`);
  const recovery = getRecoveryProgressSummary();
  if (parts.length === 0 && recovery !== null && recovery.length > 0) {
    return recovery;
  }
  if (parts.length === 0) return "";
  const base = `Right now you're leaking ${parts.join(", ")}.`;
  return recovery !== null && recovery.length > 0
    ? `${base} ${recovery}`
    : base;
}
