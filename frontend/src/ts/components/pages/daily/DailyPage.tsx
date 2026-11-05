import { JSXElement, Show } from "solid-js";

import { getActivePage } from "../../../states/core";
import { DailyBoard } from "./DailyBoard";

export function DailyPage(): JSXElement {
  return (
    <div class="content-grid full-width py-8">
      <Show when={getActivePage() === "daily"}>
        <DailyBoard variant="page" />
      </Show>
    </div>
  );
}
