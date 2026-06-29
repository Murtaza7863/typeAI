import { Config } from "../config/store";
import { setConfig } from "../config/setters";
import * as CustomText from "../test/custom-text";
import { showNoticeNotification } from "../states/notifications";
import { setCustomTextName } from "../legacy-states/custom-text-name";
import { profileHasDrillData } from "./mistake-profile";
import { before, resetAdaptiveBefore } from "./adaptive-test";
import { buildAdaptivePatternWordList } from "./adaptive-pattern-words";

export { buildAdaptivePatternWordList } from "./adaptive-pattern-words";

export async function applyAdaptivePatternTest(
  languageWords: string[],
): Promise<boolean> {
  if (Config.mode === "zen" || Config.mode === "quote") {
    showNoticeNotification(
      "Adaptive mode is not available in zen or quote mode.",
    );
    return false;
  }

  if (!profileHasDrillData()) {
    showNoticeNotification(
      "Complete a few tests with mistakes first—we need data to personalize words.",
    );
    return false;
  }

  const wordList = buildAdaptivePatternWordList(languageWords);
  if (wordList.length === 0) {
    showNoticeNotification(
      "Not enough pattern matches in this language yet. Try a normal test or drill weak spots.",
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
  CustomText.setPipeDelimiter(false);
  CustomText.setText(wordList);
  CustomText.setLimitMode("word");
  CustomText.setMode("shuffle");
  CustomText.setLimitValue(
    Config.mode === "words"
      ? Math.max(Config.words, Math.min(wordList.length, 50))
      : wordList.length,
  );
  setCustomTextName("adaptive pattern", undefined);

  return true;
}

export { resetAdaptiveBefore };
