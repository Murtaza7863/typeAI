export type CoachMode = "original" | "adaptive" | "drill";

const STORAGE_KEY = "typeai-coach-mode";

export function getCoachMode(): CoachMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "adaptive" || raw === "drill") return raw;
  } catch {
    // ignore
  }
  return "original";
}

export function setCoachMode(mode: CoachMode): void {
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
