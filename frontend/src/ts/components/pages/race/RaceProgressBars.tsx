import { For, JSXElement, Show } from "solid-js";

import { navigate } from "../../../controllers/route-controller";
import { leaveRaceAndRestore } from "../../../race/controller";
import { getActivePage } from "../../../states/core";
import {
  getLocalFinished,
  getRaceParty,
  getRaceYou,
  isRaceActive,
} from "../../../states/race";
import { Button } from "../../common/Button";

export function RaceProgressBars(props: {
  /** When true, only render during an active race on the test page */
  testOverlay?: boolean;
}): JSXElement {
  const visible = (): boolean => {
    const party = getRaceParty();
    if (party === null) return false;
    if (props.testOverlay === true) {
      return (
        getActivePage() === "test" &&
        (isRaceActive() ||
          party.status === "racing" ||
          party.status === "countdown")
      );
    }
    return true;
  };

  return (
    <Show when={visible() && getRaceParty()}>
      {(party) => (
        <div class="mb-4 flex w-full flex-col gap-2">
          <Show when={props.testOverlay === true && getLocalFinished()}>
            <p class="text-sm text-main">
              You finished! Waiting for other players…
            </p>
          </Show>
          <For each={party().players}>
            {(player) => {
              const isYou = (): boolean => player.id === getRaceYou()?.id;
              return (
                <div class="flex flex-col gap-1">
                  <div class="flex justify-between text-xs">
                    <span class={isYou() ? "text-main" : "text-sub"}>
                      {player.displayName}
                      <Show when={isYou()}>
                        <span class="ml-1">(you)</span>
                      </Show>
                      <Show
                        when={
                          player.timeMs !== null && player.timeMs !== undefined
                        }
                      >
                        <span class="ml-2 text-main">done</span>
                      </Show>
                    </span>
                    <span class="text-sub">{player.progress}%</span>
                  </div>
                  <div class="h-2 w-full overflow-hidden rounded bg-sub-alt">
                    <div
                      class="h-full rounded transition-[width] duration-150"
                      classList={{
                        "bg-main": isYou(),
                        "bg-sub": !isYou(),
                      }}
                      style={{ width: `${player.progress}%` }}
                    ></div>
                  </div>
                </div>
              );
            }}
          </For>
          <Show when={props.testOverlay === true}>
            <Button
              class="mt-1 self-start"
              text="Leave race"
              variant="text"
              onClick={() => {
                leaveRaceAndRestore();
                void navigate("/race");
              }}
            />
          </Show>
        </div>
      )}
    </Show>
  );
}
