import { Config } from "../config/store";
import { setConfig } from "../config/setters";
import * as CustomText from "../test/custom-text";
import { showNoticeNotification } from "../states/notifications";
import { setCustomTextName } from "../legacy-states/custom-text-name";
import { Mode } from "@typeai/schemas/shared";
import { CustomTextSettings } from "@typeai/schemas/results";
import {
  getMistakeProfile,
  profileHasDrillData,
  topEntries,
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

/** Build custom test text weighted toward frequent mistakes. */
export function buildAdaptiveWordList(limit = 80): string[] {
  const profile = getMistakeProfile();
  const words: string[] = [];

  const missed = topEntries(profile.missedWords, 12);
  for (const { key, count } of missed) {
    for (let i = 0; i < Math.min(count, 4); i++) {
      words.push(key);
    }
  }

  const bigrams = topEntries(profile.bigrams, 10);
  for (const { key, count } of bigrams) {
    const drill = key.length === 2 ? `${key[0]} ${key[1]}` : key;
    for (let i = 0; i < Math.min(count, 3); i++) {
      words.push(drill);
    }
  }

  const letters = topEntries(profile.wrongLetters, 8);
  for (const { key, count } of letters) {
    const filler = `${key}${key}${key} ${key}e ${key}ing`;
    for (let i = 0; i < Math.min(count, 2); i++) {
      words.push(filler);
    }
  }

  if (words.length === 0) return [];

  const shuffled = [...words].sort(() => Math.random() - 0.5);
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
    showNoticeNotification("Not enough mistake data for a custom drill yet.");
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
  CustomText.setLimitValue(Math.max(15, Math.ceil(wordList.length / 4)));
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
