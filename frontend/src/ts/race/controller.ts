import { navigationEvent } from "../events/navigation";
import {
  connectRaceWs,
  onRaceMessage,
  sendFinished,
  sendProgress,
} from "./client";
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
import { setConfig } from "../config/setters";
import { restartTestEvent } from "../events/test";

let lastSentProgress = -1;
let initialized = false;

export function initRaceController(): void {
  if (initialized) return;
  initialized = true;

  void connectRaceWs().catch(() => {
    // race server optional until user opens competitive
  });

  onRaceMessage((message) => {
    if (message.type === "countdown") {
      setCountdownSeconds(message.seconds);
      let remaining = message.seconds;
      const tick = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(tick);
          setCountdownSeconds(null);
        } else {
          setCountdownSeconds(remaining);
        }
      }, 1000);
    }

    if (message.type === "raceStart") {
      void beginSharedRace(message.words, message.startedAt);
    }

    if (message.type === "raceComplete") {
      setIsRaceActive(false);
      setRaceStartedAt(null);
      const code = getRaceParty()?.code;
      const url =
        code !== undefined && code.length > 0 ? `/race/${code}` : "/race";
      navigationEvent.dispatch({ url, options: {} });
    }
  });
}

async function beginSharedRace(
  words: string[],
  startedAt: number,
): Promise<void> {
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

  navigationEvent.dispatch({ url: "/", options: {} });
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

export function shouldBlockConfigDuringRace(): boolean {
  return isRaceActive();
}
