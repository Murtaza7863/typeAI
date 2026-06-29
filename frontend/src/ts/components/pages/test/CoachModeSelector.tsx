import { JSXElement, Show, For } from "solid-js";

import { restartTestEvent } from "../../../events/test";
import {
  getCoachMode,
  setCoachMode,
  CoachMode,
} from "../../../states/coach-mode";
import { showNoticeNotification } from "../../../states/notifications";
import { getFocus, getResultVisible } from "../../../states/test";
import { profileHasDrillData } from "../../../typing-feedback/mistake-profile";
import { cn } from "../../../utils/cn";
import { Button } from "../../common/Button";

const modes: {
  id: CoachMode;
  label: string;
  hint: string;
}[] = [
  {
    id: "original",
    label: "original",
    hint: "Standard word lists with no coaching bias.",
  },
  {
    id: "adaptive",
    label: "adaptive",
    hint: "Real words that contain your weak patterns, not the exact words you missed.",
  },
  {
    id: "drill",
    label: "drill weak spots",
    hint: "Focused repetition on your tracked mistakes and patterns.",
  },
];

export function CoachModeSelector(): JSXElement {
  const disabled = (): boolean => getFocus() || getResultVisible();
  const hasCoachData = (): boolean => profileHasDrillData();

  const selectMode = (mode: CoachMode): void => {
    if (mode !== "original" && !hasCoachData()) {
      showNoticeNotification(
        "Complete a few tests with mistakes first—we need data to personalize practice.",
      );
      return;
    }

    if (getCoachMode() === mode) return;

    setCoachMode(mode);
    restartTestEvent.dispatch();
  };

  return (
    <div
      class={cn(
        "mx-auto mb-4 flex w-max max-w-full flex-wrap place-self-center rounded-(--roundness) bg-sub-alt px-1 py-1 text-[0.85rem]",
        "transition-opacity duration-125",
        disabled() ? "pointer-events-none opacity-0" : "",
      )}
      data-ui-element="coachModeSelector"
      aria-label="Typing coach mode"
    >
      <For each={modes}>
        {(mode) => (
          <Button
            variant="text"
            class="px-3 py-1.5 capitalize"
            text={mode.label}
            active={getCoachMode() === mode.id}
            disabled={disabled() || (mode.id !== "original" && !hasCoachData())}
            aria-label={mode.hint}
            onClick={() => {
              selectMode(mode.id);
            }}
          />
        )}
      </For>
      <Show when={!hasCoachData()}>
        <span class="px-2 py-1.5 text-xs text-sub">
          complete tests to unlock
        </span>
      </Show>
    </div>
  );
}
