import { JSXElement, Show } from "solid-js";

import { getConfig } from "../../../config/store";
import { getCoachMode, getCoachModeLabel } from "../../../states/coach-mode";
import { getFocus, getResultVisible } from "../../../states/test";
import { cn } from "../../../utils/cn";

export function CoachModeSubtext(props: { class?: string }): JSXElement {
  const visible = (): boolean =>
    getConfig.mode !== "zen" &&
    getConfig.mode !== "quote" &&
    getCoachMode() !== "original" &&
    !getFocus() &&
    !getResultVisible();

  return (
    <Show when={visible()}>
      <p
        class={cn(
          "mx-auto w-max rounded-full px-3 py-0.5 text-center text-[0.7rem] tracking-wide text-main ring-1 ring-main/25",
          props.class,
        )}
        data-ui-element="coachModeSubtext"
      >
        {getCoachModeLabel()}
      </p>
    </Show>
  );
}
