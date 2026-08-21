import { For, JSXElement, Show } from "solid-js";

import { navigate } from "../../../controllers/route-controller";
import { playAgain } from "../../../race/client";
import { leaveRaceAndRestore, openRaceResults } from "../../../race/controller";
import { getActivePage } from "../../../states/core";
import {
  getLocalFinished,
  getRaceParty,
  getRaceYou,
  isRaceActive,
} from "../../../states/race";
import { Button } from "../../common/Button";
import { RaceStandings } from "./RaceStandings";

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

  const goToLobby = (code: string): void => {
    void navigate(code.length > 0 ? `/race/${code}` : "/race", { force: true });
  };

  return (
    <Show when={visible() && getRaceParty()}>
      {(party) => (
        <div class="mb-4 flex w-full flex-col gap-2">
          <Show when={party().status === "finished"}>
            <div class="bg-bg-2 rounded-lg border border-sub/30 p-4">
              <h2 class="mb-3 text-lg text-main">Race complete</h2>
              <RaceStandings />
              <div class="flex flex-wrap gap-2">
                <Show when={getRaceYou()?.isHost}>
                  <Button
                    text="Play again"
                    onClick={() => {
                      playAgain();
                      goToLobby(party().code);
                    }}
                  />
                </Show>
                <Button
                  text="View results"
                  variant="text"
                  onClick={() => openRaceResults()}
                />
                <Button
                  class="self-start"
                  text="Leave race"
                  variant="text"
                  onClick={() => {
                    leaveRaceAndRestore();
                    void navigate("/race", { force: true });
                  }}
                />
              </div>
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
          <Show
            when={props.testOverlay === true && party().status !== "finished"}
          >
            <Button
              class="mt-1 self-start"
              text="Leave race"
              variant="text"
              onClick={() => {
                leaveRaceAndRestore();
                void navigate("/race", { force: true });
              }}
            />
          </Show>
        </div>
      )}
    </Show>
  );
}
