import { CompletedEvent, KeyStats } from "@typeai/schemas/results";
import { TypingSessionInput } from "@typeai/schemas/typing-feedback";
import { createSignal } from "solid-js";
import { topEntries } from "./mistake-profile";
import { getSessionMistakeSnapshot } from "./session-mistakes";

const STORAGE_KEY = "typeai-local-typing-history";
const MAX_SESSIONS = 50;
const [historyVersion, setHistoryVersion] = createSignal(0);

function statsFromTimings(
  timings: number[] | "toolong" | undefined,
): KeyStats | undefined {
  if (timings === undefined || timings === "toolong" || timings.length < 2) {
    return undefined;
  }
  const average = timings.reduce((a, b) => a + b, 0) / timings.length;
  const variance =
    timings.reduce((sum, t) => sum + (t - average) ** 2, 0) / timings.length;
  return {
    average: Math.round(average * 100) / 100,
    sd: Math.round(Math.sqrt(variance) * 100) / 100,
  };
}

export function completedEventToSessionInput(
  event: CompletedEvent,
): TypingSessionInput {
  const snap = getSessionMistakeSnapshot();
  return {
    wpm: event.wpm,
    acc: event.acc,
    consistency: event.consistency,
    charStats: event.charStats,
    mode: event.mode,
    mode2: event.mode2,
    language: event.language,
    chartData: event.chartData,
    restartCount: event.restartCount,
    incompleteTestSeconds: event.incompleteTestSeconds,
    incompleteTests: event.incompleteTests,
    keySpacingStats: statsFromTimings(event.keySpacing),
    keyDurationStats: statsFromTimings(event.keyDuration),
    topWrongLetters: topEntries(snap.wrongLetters, 5),
    topBigrams: topEntries(snap.bigrams, 5),
    topMissedWords: topEntries(snap.missedWords, 5),
  };
}

export function getLocalTypingSessions(): TypingSessionInput[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null || raw === "") return [];
    const parsed = JSON.parse(raw) as TypingSessionInput[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appendLocalTypingSession(event: CompletedEvent): void {
  const sessions = getLocalTypingSessions();
  sessions.unshift(completedEventToSessionInput(event));
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(sessions.slice(0, MAX_SESSIONS)),
  );
  setHistoryVersion((version) => version + 1);
}

export function getLocalTypingSessionCount(): number {
  return getLocalTypingSessions().length;
}

export function clearLocalTypingHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
  void import("./mistake-profile").then((m) => m.clearMistakeProfile());
  setHistoryVersion((version) => version + 1);
}

export function getLocalTypingHistoryVersion(): number {
  return historyVersion();
}
