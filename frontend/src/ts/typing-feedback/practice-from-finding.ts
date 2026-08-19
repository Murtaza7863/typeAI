import {
  TypingFeedbackMistake,
  TypingFeedbackPracticeKind,
} from "@typeai/schemas/typing-feedback";
import { setConfig } from "../config/setters";
import { Config } from "../config/store";
import { navigationEvent } from "../events/navigation";
import { restartTestEvent } from "../events/test";
import { setCoachMode } from "../states/coach-mode";
import { showNoticeNotification } from "../states/notifications";
import * as CustomText from "../test/custom-text";
import * as PractiseWords from "../test/practise-words";
import { buildAdaptiveWordList } from "./adaptive-test";
import {
  activeTopEntries,
  getMistakeProfile,
  profileHasDrillData,
} from "./mistake-profile";

function inferPracticeKind(
  mistake: TypingFeedbackMistake,
): TypingFeedbackPracticeKind {
  if (mistake.practiceKind !== undefined) return mistake.practiceKind;
  const text = `${mistake.issue} ${mistake.evidence}`.toLowerCase();
  if (
    text.includes("letter") ||
    text.includes("pinky") ||
    text.includes("finger") ||
    text.includes("key timing") ||
    text.includes("hesitat")
  ) {
    if (
      text.includes("timing") ||
      text.includes("hesitat") ||
      text.includes("slow")
    ) {
      return "timing";
    }
    return "letters";
  }
  if (
    text.includes("pair") ||
    text.includes("combination") ||
    text.includes("bigram")
  ) {
    return "bigrams";
  }
  if (
    text.includes("substitut") ||
    text.includes("wrong-key") ||
    text.includes("→")
  ) {
    return "swaps";
  }
  if (text.includes("word")) return "words";
  return "all";
}

function pushWeighted(
  words: string[],
  item: string,
  count: number,
  min: number,
  max: number,
): void {
  const reps = Math.min(Math.max(Math.ceil(count * 2) + min, min), max);
  for (let i = 0; i < reps; i++) words.push(item);
}

function buildWordListForKind(kind: TypingFeedbackPracticeKind): string[] {
  const profile = getMistakeProfile();

  if (kind === "all") {
    return buildAdaptiveWordList(120);
  }

  const words: string[] = [];

  if (kind === "words") {
    for (const { key, count } of activeTopEntries(
      profile.missedWords,
      "word",
      20,
    )) {
      pushWeighted(words, key, count, 5, 16);
    }
  }

  if (kind === "bigrams") {
    for (const { key, count } of activeTopEntries(
      profile.bigrams,
      "bigram",
      16,
    )) {
      const drill =
        key.length === 2
          ? `${key[0]}${key[1]} ${key[0]} ${key[1]} ${key}`
          : key;
      pushWeighted(words, drill, count, 4, 12);
    }
  }

  if (kind === "swaps") {
    for (const { key, count } of activeTopEntries(
      profile.typedInstead,
      "swap",
      12,
    )) {
      const parts = key.split("→");
      if (parts.length === 2) {
        pushWeighted(words, `${parts[0]} ${parts[1]}`, count, 3, 10);
      }
    }
  }

  if (kind === "letters" || kind === "timing") {
    const letterSource =
      kind === "timing" && Object.keys(profile.weakLetterScores).length > 0
        ? Object.entries(profile.weakLetterScores)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([key, count]) => ({
              key,
              count: Math.max(1, Math.round(count)),
            }))
        : activeTopEntries(profile.wrongLetters, "letter", 12);

    for (const { key, count } of letterSource) {
      const filler = `${key}e ${key}at ${key}ing ${key}er ${key}${key}`;
      pushWeighted(words, filler, count, 4, 12);
    }
  }

  if (words.length === 0) {
    return buildAdaptiveWordList(120);
  }

  const shuffled = [...words].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 100);
}

function startCustomPractice(wordList: string[], label: string): boolean {
  if (wordList.length === 0) {
    showNoticeNotification(
      "Not enough coach data yet to build a practice set.",
      {
        durationMs: 3500,
      },
    );
    return false;
  }

  // Snapshot before overwriting custom text. setConfig("mode") resets
  // PractiseWords.before, so restore the snapshot after that call.
  const previousMode = Config.mode;
  const previousPunctuation = Config.punctuation;
  const previousNumbers = Config.numbers;
  const previousCustomText =
    Config.mode === "custom" ? CustomText.getData() : null;

  CustomText.setPipeDelimiter(true);
  CustomText.setText(wordList);
  CustomText.setMode("shuffle");
  CustomText.setLimitMode("section");
  CustomText.setLimitValue(
    Math.min(40, Math.max(15, Math.ceil(wordList.length / 3))),
  );
  setConfig("mode", "custom", { nosave: true });
  setConfig("punctuation", false, { nosave: true });
  setConfig("numbers", false, { nosave: true });
  setCoachMode("original");

  PractiseWords.before.mode = previousMode;
  PractiseWords.before.punctuation = previousPunctuation;
  PractiseWords.before.numbers = previousNumbers;
  PractiseWords.before.customText = previousCustomText;

  navigationEvent.dispatch({ url: "/", options: { force: true } });
  restartTestEvent.dispatch();
  showNoticeNotification(`Practice started: ${label}`, { durationMs: 2500 });
  return true;
}

export function startPracticeFromFinding(
  mistake: TypingFeedbackMistake,
): boolean {
  const kind = inferPracticeKind(mistake);
  const words = buildWordListForKind(kind);
  const labels: Record<TypingFeedbackPracticeKind, string> = {
    letters: "weak letters",
    bigrams: "key combinations",
    swaps: "wrong-key swaps",
    words: "missed words",
    timing: "hesitant keys",
    all: "all weak spots",
  };
  return startCustomPractice(words, labels[kind]);
}

export function startPracticeAllWeakSpots(): boolean {
  return startCustomPractice(buildAdaptiveWordList(120), "all weak spots");
}

export function canPracticeFindings(): boolean {
  return buildAdaptiveWordList(20).length > 0;
}

export function startAdaptivePractice(): boolean {
  if (!profileHasDrillData()) {
    showNoticeNotification(
      "Complete a few tests with mistakes first—we need data to personalize practice.",
    );
    return false;
  }

  setCoachMode("adaptive");
  navigationEvent.dispatch({ url: "/", options: { force: true } });
  restartTestEvent.dispatch();
  showNoticeNotification(
    "Adaptive will use your current weak letters, pairs, and words.",
    { durationMs: 2500 },
  );
  return true;
}
