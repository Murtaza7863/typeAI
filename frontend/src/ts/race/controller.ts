import { FunboxName } from "@typeai/schemas/configs";
import { CustomTextSettings } from "@typeai/schemas/results";
import { Mode } from "@typeai/schemas/shared";

import { setConfig } from "../config/setters";
import { Config } from "../config/store";
import { navigationEvent } from "../events/navigation";
import { restartTestEvent } from "../events/test";
import {
  getLocalFinished,
  getRaceParty,
  getRaceStartedAt,
  isRaceActive,
  setCountdownSeconds,
  setIsRaceActive,
  setRaceStartedAt,
} from "../states/race";
import * as TestState from "../test/test-state";
import * as TestInput from "../test/test-input";
import * as TestWords from "../test/test-words";
import * as CustomText from "../test/custom-text";
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
};

let lastSentProgress = -1;
let initialized = false;
let countdownTick: ReturnType<typeof setInterval> | null = null;
let savedBeforeRace: RaceSettingsSnapshot | null = null;

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
  };
}

export function restoreAfterRace(): void {
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
  setConfig("mode", snapshot.mode, { nosave: true });
}

export function leaveRaceAndRestore(): void {
  leaveParty();
  restoreAfterRace();
}

export function initRaceController(): void {
  if (initialized) return;
  initialized = true;

  // Connect lazily when the race page opens — avoid background WS errors
  // against APIs that do not host /race-ws.

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
      beginSharedRace(message.words, message.startedAt);
    }

    if (message.type === "raceComplete") {
      restoreAfterRace();
      const code = getRaceParty()?.code;
      const url =
        code !== undefined && code.length > 0 ? `/race/${code}` : "/race";
      navigationEvent.dispatch({ url, options: { force: true } });
    }
  });
}

function beginSharedRace(words: string[], startedAt: number): void {
  snapshotSettingsIfNeeded();
  setIsRaceActive(true);
  setRaceStartedAt(startedAt);
  lastSentProgress = -1;

  CustomText.setText(words);
  CustomText.setMode("repeat");
  CustomText.setLimitMode("word");
  CustomText.setLimitValue(words.length);
  setConfig("mode", "custom", { nosave: true });
  setConfig("punctuation", false, { nosave: true });
  setConfig("numbers", false, { nosave: true });
  setConfig("funbox", [], { nosave: true });

  navigationEvent.dispatch({ url: "/", options: { force: true } });
  restartTestEvent.dispatch();
}

export function reportRaceProgressFromTest(): void {
  if (!isRaceActive() || getLocalFinished()) return;
  if (!TestState.isActive) return;

  const words = TestWords.words.list;
  if (words.length === 0) return;

  const totalChars = words.join(" ").length;
  if (totalChars === 0) return;

  const history = TestInput.input.getHistory();
  const completedJoined = history.length === 0 ? 0 : history.join(" ").length;
  const spaceAfter =
    history.length > 0 && TestState.activeWordIndex >= history.length ? 1 : 0;
  const charsTyped =
    completedJoined + spaceAfter + TestInput.input.current.length;

  const wordPct = Math.floor((TestState.activeWordIndex / words.length) * 100);
  const charPct = Math.min(
    100,
    Math.floor((Math.min(charsTyped, totalChars) / totalChars) * 100),
  );
  const progress = Math.max(0, Math.min(100, Math.max(wordPct, charPct)));

  if (progress === lastSentProgress) return;
  lastSentProgress = progress;
  sendProgress(progress);
}

export function reportRaceFinished(): void {
  if (!isRaceActive() || getLocalFinished()) return;
  const startedAt = getRaceStartedAt();
  const timeMs = startedAt !== null ? Math.max(1, Date.now() - startedAt) : 1;
  sendProgress(100);
  sendFinished(timeMs);
}
