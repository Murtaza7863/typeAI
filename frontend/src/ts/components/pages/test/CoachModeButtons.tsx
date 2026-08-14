import { For, JSXElement, Show } from "solid-js";

import { restartTestEvent } from "../../../events/test";
import {
  getCoachMode,
  setCoachMode,
  CoachMode,
} from "../../../states/coach-mode";
import { showNoticeNotification } from "../../../states/notifications";
import {
  getMistakeProfileVersion,
  profileHasDrillData,
} from "../../../typing-feedback/mistake-profile";
import { cn } from "../../../utils/cn";
import { Button } from "../../common/Button";

const modes: {
  id: CoachMode;
  label: string;
}[] = [
  { id: "original", label: "original" },
  { id: "adaptive", label: "adaptive" },
  { id: "drill", label: "drill" },
];

export function CoachModeButtons(props: {
  class?: string;
  disabled?: boolean;
}): JSXElement {
  const hasCoachData = (): boolean => {
    getMistakeProfileVersion();
    return profileHasDrillData();
  };

  const selectMode = (mode: CoachMode): void => {
    if (props.disabled) return;

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
      class={cn("flex flex-wrap items-center gap-0.5", props.class)}
      data-ui-element="coachModeSelector"
      aria-label="Typing coach mode"
    >
      <span class="mx-0.5 hidden text-sub sm:inline">|</span>
      <For each={modes}>
        {(mode) => (
          <Button
            variant="text"
            class="px-2 py-1 capitalize"
            text={mode.label}
            active={getCoachMode() === mode.id}
            disabled={
              props.disabled === true ||
              (mode.id !== "original" && !hasCoachData())
            }
            onClick={() => {
              selectMode(mode.id);
            }}
          />
        )}
      </For>
      <Show when={!hasCoachData()}>
        <span class="hidden px-1 text-[0.65rem] text-sub lg:inline">
          unlock with mistakes
        </span>
      </Show>
    </div>
  );
}
