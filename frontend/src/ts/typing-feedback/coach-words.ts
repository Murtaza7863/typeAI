import { getCoachMode, CoachMode } from "../states/coach-mode";
import { showNoticeNotification } from "../states/notifications";
import { buildAdaptiveWordList } from "./adaptive-test";
import { buildAdaptivePatternWordList } from "./adaptive-pattern-words";
import { profileHasDrillData } from "./mistake-profile";

export function resolveCoachWordList(
  languageWords: string[],
  mode: CoachMode = getCoachMode(),
): string[] | null {
  if (mode === "original") return null;

  if (mode === "adaptive") {
    const words = buildAdaptivePatternWordList(languageWords);
    return words.length > 0 ? words : null;
  }

  if (mode === "drill") {
    const words = buildAdaptiveWordList();
    return words.length > 0 ? words : null;
  }

  return null;
}

export function validateCoachMode(mode: CoachMode = getCoachMode()): boolean {
  if (mode === "original") return true;

  if (!profileHasDrillData()) {
    showNoticeNotification(
      "Complete a few tests with mistakes first—we need data to personalize practice.",
    );
    return false;
  }

  return true;
}
