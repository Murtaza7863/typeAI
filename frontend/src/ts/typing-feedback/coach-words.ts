import { getCoachMode, CoachMode } from "../states/coach-mode";
import { buildAdaptiveWordList } from "./adaptive-test";
import { buildAdaptivePatternWordList } from "./adaptive-pattern-words";

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
