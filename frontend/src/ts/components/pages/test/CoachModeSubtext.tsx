import { JSXElement, Show } from "solid-js";

import { getConfig } from "../../../config/store";
import { getCoachModeLabel } from "../../../states/coach-mode";
import { getFocus, getResultVisible } from "../../../states/test";
import { cn } from "../../../utils/cn";

export function CoachModeSubtext(props: { class?: string }): JSXElement {
  const visible = (): boolean =>
    getConfig.mode !== "zen" &&
    getConfig.mode !== "quote" &&
    !getFocus() &&
    !getResultVisible();

  return (
    <Show when={visible()}>
      <p
        class={cn("text-center text-xs text-sub capitalize", props.class)}
        data-ui-element="coachModeSubtext"
      >
        {getCoachModeLabel()}
      </p>
    </Show>
  );
}
