import { For, JSXElement, Show } from "solid-js";

import { navigate } from "../../../controllers/route-controller";
import { leaveRaceAndRestore } from "../../../race/controller";
import { getActivePage } from "../../../states/core";
import {
  getLocalFinished,
  getRaceParty,
  getRaceYou,
  getStandings,
  isRaceActive,
} from "../../../states/race";
import { Button } from "../../common/Button";

function formatTime(timeMs: number | null | undefined): string {
  if (timeMs === null || timeMs === undefined) return "DNF";
  return `${(timeMs / 1000).toFixed(2)}s`;
}

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
          getLocalFinished() ||
          party.status === "racing" ||
          party.status === "countdown" ||
          party.status === "finished")
      );
    }
    return true;
  };

  const ranked = () => {
    const standings = getStandings();
    if (standings.length > 0) return standings;
    return getRaceParty()?.players ?? [];
  };

  return (
    <Show when={visible() && getRaceParty()}>
      {(party) => (
        <div class="mb-4 flex w-full flex-col gap-2">
          <Show when={party().status === "finished"}>
            <div class="bg-bg-2 rounded-lg border border-sub/30 p-4">
              <h2 class="mb-3 text-lg text-main">Race complete</h2>
              <ol class="mb-4 flex flex-col gap-2">
                <For each={ranked()}>
                  {(player, index) => (
                    <li class="flex items-center justify-between text-sm">
                      <span>
                        #{index() + 1} {player.displayName}
                        <Show when={player.id === party().winnerId}>
                          <span class="ml-2 text-xs text-main">winner</span>
                        </Show>
                      </span>
                      <span class="text-sub">{formatTime(player.timeMs)}</span>
                    </li>
                  )}
                </For>
              </ol>
              <Button
                text="View results"
                onClick={() => {
                  const code = party().code;
                  void navigate(
                    code !== undefined && code.length > 0
                      ? `/race/${code}`
                      : "/race",
                    { force: true },
                  );
                }}
              />
            </div>
          </Show>
          <Show
            when={
              props.testOverlay === true &&
              getLocalFinished() &&
              party().status !== "finished"
            }
          >
            <p class="text-sm text-main">
              You finished! Waiting for other players…
            </p>
          </Show>
          <Show when={party().status !== "finished"}>
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
                            player.timeMs !== null &&
                            player.timeMs !== undefined
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
          </Show>
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
