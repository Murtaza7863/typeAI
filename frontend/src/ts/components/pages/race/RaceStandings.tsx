import { RacePlayer } from "@typeai/schemas/race";
import { For, JSXElement, Show } from "solid-js";

import { getRaceParty, getStandings } from "../../../states/race";

function formatTime(timeMs: number | null | undefined): string {
  if (timeMs === null || timeMs === undefined) return "DNF";
  return `${(timeMs / 1000).toFixed(2)}s`;
}

export function rankedRacePlayers(): RacePlayer[] {
  const party = getRaceParty();
  const source =
    getStandings().length > 0 ? getStandings() : (party?.players ?? []);
  const timed = party?.settings?.mode === "time";
  return [...source].sort((a, b) => {
    if (timed) {
      if (b.progress !== a.progress) return b.progress - a.progress;
      if (typeof a.timeMs === "number" && typeof b.timeMs === "number") {
        return a.timeMs - b.timeMs;
      }
      if (typeof a.timeMs === "number") return -1;
      if (typeof b.timeMs === "number") return 1;
      return 0;
    }
    if (typeof a.timeMs === "number" && typeof b.timeMs === "number") {
      return a.timeMs - b.timeMs;
    }
    if (typeof a.timeMs === "number") return -1;
    if (typeof b.timeMs === "number") return 1;
    return b.progress - a.progress;
  });
}

export function RaceStandings(): JSXElement {
  const winnerId = (): string | null | undefined => getRaceParty()?.winnerId;

  return (
    <ol class="mb-6 flex flex-col gap-2">
      <For each={rankedRacePlayers()}>
        {(player, index) => (
          <li class="flex items-center justify-between rounded bg-bg px-3 py-2">
            <span>
              #{index() + 1} {player.displayName}
              <Show when={player.id === winnerId()}>
                <span class="ml-2 text-xs text-main">winner</span>
              </Show>
            </span>
            <span class="text-sub">{formatTime(player.timeMs)}</span>
          </li>
        )}
      </For>
    </ol>
  );
}
