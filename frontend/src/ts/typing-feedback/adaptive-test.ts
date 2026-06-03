import { Config } from "../config/store";
import { setConfig } from "../config/setters";
import * as CustomText from "../test/custom-text";
import { showNoticeNotification } from "../states/notifications";
import { setCustomTextName } from "../legacy-states/custom-text-name";
import { Mode } from "@typeai/schemas/shared";
import { CustomTextSettings } from "@typeai/schemas/results";
import {
  activeTopEntries,
  getMistakeProfile,
  profileHasDrillData,
} from "./mistake-profile";

type Before = {
  mode: Mode | null;
  punctuation: boolean | null;
  numbers: boolean | null;
  customText: CustomTextSettings | null;
};

export const before: Before = {
  mode: null,
  punctuation: null,
  numbers: null,
  customText: null,
};

/** Heavier repetition for higher mistake counts. */
function drillRepeats(count: number, min: number, max: number): number {
  const weighted = Math.ceil(count * 2.5) + min;
  return Math.min(Math.max(weighted, min), max);
}

function pushWeighted(
  words: string[],
  item: string,
  count: number,
  min: number,
  max: number,
): void {
  const reps = drillRepeats(count, min, max);
  for (let i = 0; i < reps; i++) {
    words.push(item);
  }
}

/** Build custom test text heavily weighted toward frequent mistakes. */
export function buildAdaptiveWordList(limit = 140): string[] {
  const profile = getMistakeProfile();
  const words: string[] = [];

  const missed = activeTopEntries(profile.missedWords, "word", 16);
  for (const { key, count } of missed) {
    pushWeighted(words, key, count, 4, 14);
  }

  const bigrams = activeTopEntries(profile.bigrams, "bigram", 14);
  for (const { key, count } of bigrams) {
    const drill =
      key.length === 2 ? `${key[0]}${key[1]} ${key[0]} ${key[1]} ${key}` : key;
    pushWeighted(words, drill, count, 3, 10);
  }

  const swaps = activeTopEntries(profile.typedInstead, "swap", 8);
  for (const { key, count } of swaps) {
    const parts = key.split("→");
    if (parts.length === 2) {
      pushWeighted(words, `${parts[0]} ${parts[1]}`, count, 2, 8);
    }
  }

  const letters = activeTopEntries(profile.wrongLetters, "letter", 10);
  for (const { key, count } of letters) {
    const filler = `${key}e ${key}at ${key}ing ${key}er ${key}${key}`;
    pushWeighted(words, filler, count, 3, 9);
  }

  if (words.length === 0) return [];

  const priority = words.slice(0, Math.min(40, words.length));
  const rest = words.slice(priority.length);
  const pool = [...priority, ...priority, ...rest];
  const shuffled = pool.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, limit);
}

export function applyAdaptiveTest(): boolean {
  if (Config.mode === "zen") {
    showNoticeNotification("Adaptive drills are not available in zen mode.");
    return false;
  }

  if (!profileHasDrillData()) {
    showNoticeNotification(
      "Complete a few tests with mistakes first—we need data to build your drill.",
    );
    return false;
  }

  const wordList = buildAdaptiveWordList();
  if (wordList.length === 0) {
    showNoticeNotification(
      "Not enough active weak spots to drill—you may have recovered them. Run a normal test to find new patterns.",
    );
    return false;
  }

  before.mode = Config.mode;
  before.punctuation = Config.punctuation;
  before.numbers = Config.numbers;
  if (Config.mode === "custom") {
    before.customText = CustomText.getData();
  }

  setConfig("mode", "custom", { nosave: true });
  CustomText.setPipeDelimiter(true);
  CustomText.setText(wordList);
  CustomText.setLimitMode("section");
  CustomText.setMode("shuffle");
  CustomText.setLimitValue(Math.max(25, Math.ceil(wordList.length / 2)));
  setCustomTextName("adaptive", undefined);

  return true;
}

export function resetAdaptiveBefore(): void {
  before.mode = null;
  before.punctuation = null;
  before.numbers = null;
  before.customText = null;
}

export function revertAdaptiveSettings(): void {
  if (before.mode === null) return;

  if (before.punctuation !== null) {
    setConfig("punctuation", before.punctuation);
  }
  if (before.numbers !== null) {
    setConfig("numbers", before.numbers);
  }
  if (before.customText) {
    CustomText.setText(before.customText.text);
    CustomText.setLimitMode(before.customText.limit.mode);
    CustomText.setLimitValue(before.customText.limit.value);
    CustomText.setPipeDelimiter(before.customText.pipeDelimiter);
  }
  setConfig("mode", before.mode);
  resetAdaptiveBefore();
}
