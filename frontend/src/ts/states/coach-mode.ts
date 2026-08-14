import { createSignal } from "solid-js";

export type CoachMode = "original" | "adaptive" | "drill";

const STORAGE_KEY = "typeai-coach-mode";

function readCoachMode(): CoachMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "adaptive" || raw === "drill") return raw;
  } catch {
    // ignore
  }
  return "original";
}

export const [getCoachMode, setCoachModeState] =
  createSignal<CoachMode>(readCoachMode());

export function setCoachMode(mode: CoachMode): void {
  setCoachModeState(mode);
  try {
    if (mode === "original") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, mode);
    }
  } catch {
    // ignore
  }
}

export function getCoachModeLabel(mode = getCoachMode()): string {
  if (mode === "drill") return "drill weak spots";
  if (mode === "adaptive") return "adaptive — your mistakes";
  return mode;
}
