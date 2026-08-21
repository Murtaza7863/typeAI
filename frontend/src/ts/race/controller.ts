import {
  ConfidenceMode,
  Difficulty,
  FunboxName,
  MinimumAccuracy,
  MinimumBurst,
  MinimumWordsPerMinute,
  StopOnError,
} from "@typeai/schemas/configs";
import { RaceSettings } from "@typeai/schemas/race";
import { CustomTextSettings } from "@typeai/schemas/results";
import { Mode } from "@typeai/schemas/shared";

import { setConfig } from "../config/setters";
import { Config } from "../config/store";
import { navigationEvent } from "../events/navigation";
import { restartTestEvent } from "../events/test";
import { setCustomTextName } from "../legacy-states/custom-text-name";
import { getActivePage } from "../states/core";
import {
  getLocalFinished,
  getRaceParty,
  getRaceStartedAt,
  isRaceActive,
  setCountdownSeconds,
  setIsRaceActive,
  setRaceStartedAt,
} from "../states/race";
import * as CustomText from "../test/custom-text";
import * as TestInput from "../test/test-input";
import * as TestState from "../test/test-state";
import * as TestWords from "../test/test-words";
import {
  leaveParty,
  onRaceMessage,
  sendFinished,
  sendProgress,
} from "./client";

type RaceSettingsSnapshot = {
  mode: Mode;
  punctuation: boolean;
  numbers: boolean;
  funbox: FunboxName[];
  customText: CustomTextSettings;
  difficulty: Difficulty;
  minWpm: MinimumWordsPerMinute;
  minAcc: MinimumAccuracy;
  minBurst: MinimumBurst;
  stopOnError: StopOnError;
  confidenceMode: ConfidenceMode;
};

let lastSentProgress = -1;
let initialized = false;
let countdownTick: ReturnType<typeof setInterval> | null = null;
let savedBeforeRace: RaceSettingsSnapshot | null = null;
let pendingRaceResults = false;
let openedRaceResults = false;
let localFinishInProgress = false;

function clearCountdownTick(): void {
  if (countdownTick === null) return;
  clearInterval(countdownTick);
  countdownTick = null;
}

function snapshotSettingsIfNeeded(): void {
  if (savedBeforeRace !== null) return;
  savedBeforeRace = {
    mode: Config.mode,
    punctuation: Config.punctuation,
    numbers: Config.numbers,
    funbox: [...Config.funbox],
    customText: structuredClone(CustomText.getData()),
    difficulty: Config.difficulty,
    minWpm: Config.minWpm,
    minAcc: Config.minAcc,
    minBurst: Config.minBurst,
    stopOnError: Config.stopOnError,
    confidenceMode: Config.confidenceMode,
  };
}

export function restoreAfterRace(): void {
  pendingRaceResults = false;
  clearCountdownTick();
  setCountdownSeconds(null);
  setIsRaceActive(false);
  setRaceStartedAt(null);

  const snapshot = savedBeforeRace;
  savedBeforeRace = null;
  if (snapshot === null) return;

  CustomText.applyData(snapshot.customText);
  setConfig("punctuation", snapshot.punctuation, { nosave: true });
  setConfig("numbers", snapshot.numbers, { nosave: true });
  setConfig("funbox", snapshot.funbox, { nosave: true });
  setConfig("difficulty", snapshot.difficulty, { nosave: true });
  setConfig("minWpm", snapshot.minWpm, { nosave: true });
  setConfig("minAcc", snapshot.minAcc, { nosave: true });
  setConfig("minBurst", snapshot.minBurst, { nosave: true });
  setConfig("stopOnError", snapshot.stopOnError, { nosave: true });
  setConfig("confidenceMode", snapshot.confidenceMode, { nosave: true });
  setConfig("mode", snapshot.mode, { nosave: true });
}

export function leaveRaceAndRestore(): void {
  openedRaceResults = false;
  leaveParty();
  restoreAfterRace();
}

export function initRaceController(): void {
  if (initialized) return;
  initialized = true;

  onRaceMessage((message) => {
    if (message.type === "countdown") {
      clearCountdownTick();
      setCountdownSeconds(message.seconds);
      let remaining = message.seconds;
      countdownTick = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearCountdownTick();
          setCountdownSeconds(null);
        } else {
          setCountdownSeconds(remaining);
        }
      }, 1000);
    }

    if (message.type === "raceStart") {
      clearCountdownTick();
      setCountdownSeconds(null);
      beginSharedRace(message.words, message.startedAt, message.settings);
    }

    if (message.type === "raceComplete") {
      if (localFinishInProgress) {
        pendingRaceResults = true;
        return;
      }
      goToRaceResults();
    }

    if (
      message.type === "error" &&
      /party not found|player not found|party ended/i.test(message.message)
    ) {
      restoreAfterRace();
    }
  });
}

function beginSharedRace(
  words: string[],
  startedAt: number,
  settings?: RaceSettings,
): void {
  snapshotSettingsIfNeeded();
  setIsRaceActive(true);
  setRaceStartedAt(startedAt);
  lastSentProgress = -1;
  pendingRaceResults = false;
  openedRaceResults = false;

  const text = words.length > 0 ? words : ["go"];
  const timed = settings?.mode === "time";
  CustomText.applyData({
    text,
    mode: "repeat",
    limit: timed
      ? { value: settings.time, mode: "time" }
      : { value: text.length, mode: "word" },
    pipeDelimiter: false,
  });
  setCustomTextName("", false);
  setConfig("mode", "custom", { nosave: true });
  setConfig("punctuation", false, { nosave: true });
  setConfig("numbers", false, { nosave: true });
  setConfig("funbox", [], { nosave: true });
  setConfig("difficulty", "normal", { nosave: true });
  setConfig("minWpm", "off", { nosave: true });
  setConfig("minAcc", "off", { nosave: true });
  setConfig("minBurst", "off", { nosave: true });
  setConfig("stopOnError", "off", { nosave: true });
  setConfig("confidenceMode", "off", { nosave: true });

  // Navigating to the test page already restarts it in beforeShow.
  // Restarting first (while still on /race) can leave the test stuck.
  if (getActivePage() === "test") {
    restartTestEvent.dispatch({ noAnim: true });
  } else {
    navigationEvent.dispatch({ url: "/", options: { force: true } });
  }
}

export function reportRaceProgressFromTest(): void {
  if (!isRaceActive() || getLocalFinished()) return;
  if (!TestState.isActive) return;

  const words = TestWords.words.list;
  if (words.length === 0) return;

  const history = TestInput.input.getHistory();
  const completedJoined = history.length === 0 ? 0 : history.join(" ").length;
  const spaceAfter =
    history.length > 0 && TestState.activeWordIndex >= history.length ? 1 : 0;
  const charsTyped =
    completedJoined + spaceAfter + TestInput.input.current.length;

  const settings = getRaceParty()?.settings;
  let progress: number;
  if (settings?.mode === "time") {
    const targetChars = Math.max(1, (settings.time ?? 30) * 10);
    progress = Math.min(
      100,
      Math.floor((Math.max(0, charsTyped) / targetChars) * 100),
    );
  } else {
    const totalChars = words.join(" ").length;
    if (totalChars === 0) return;
    const wordPct = Math.floor(
      (TestState.activeWordIndex / words.length) * 100,
    );
    const charPct = Math.min(
      100,
      Math.floor((Math.min(charsTyped, totalChars) / totalChars) * 100),
    );
    progress = Math.max(0, Math.min(100, Math.max(wordPct, charPct)));
  }

  if (progress === lastSentProgress) return;
  lastSentProgress = progress;
  sendProgress(progress);
}

export function reportRaceFinished(): void {
  if (!isRaceActive() || getLocalFinished()) return;
  const startedAt = getRaceStartedAt();
  const timeMs = startedAt !== null ? Math.max(1, Date.now() - startedAt) : 1;
  if (getRaceParty()?.settings?.mode !== "time") {
    sendProgress(100);
  }
  sendFinished(timeMs);
}

export function beginLocalRaceFinish(): void {
  localFinishInProgress = true;
}

export function settleRaceCompleteNavigation(): void {
  localFinishInProgress = false;
  if (pendingRaceResults || getRaceParty()?.status === "finished") {
    goToRaceResults();
  }
}

function goToRaceResults(): void {
  if (openedRaceResults) return;
  openedRaceResults = true;
  pendingRaceResults = false;
  const code = getRaceParty()?.code;
  restoreAfterRace();
  const url = code !== undefined && code.length > 0 ? `/race/${code}` : "/race";
  navigationEvent.dispatch({ url, options: { force: true } });
}
