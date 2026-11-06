import { RacePlayer } from "@typeai/schemas/race";
import { For, JSXElement, Show } from "solid-js";

import { getRaceParty, getStandings } from "../../../states/race";

function formatTime(timeMs: number | null | undefined): string {
  if (timeMs === null || timeMs === undefined) return "DNF";
  return `${(timeMs / 1000).toFixed(2)}s`;
}

function scoreLabel(player: RacePlayer): string {
  const party = getRaceParty();
  if (party?.settings?.mode === "time") {
    const seconds =
      (typeof player.timeMs === "number"
        ? player.timeMs
        : (party.settings.time ?? 30) * 1000) / 1000;
    if (typeof player.score === "number" && seconds > 0) {
      const wpm = Math.round(player.score / 5 / (seconds / 60));
      return `${wpm} wpm · ${formatTime(player.timeMs)}`;
    }
    return `${player.progress}% · ${formatTime(player.timeMs)}`;
  }
  return formatTime(player.timeMs);
}

function resultHeadline(): string {
  const ranked = rankedRacePlayers();
  const first = ranked[0];
  const second = ranked[1];
  if (first === undefined) return "Race complete";
  const timed = getRaceParty()?.settings?.mode === "time";
  const tied =
    second !== undefined &&
    (timed
      ? (first.score ?? first.progress) === (second.score ?? second.progress)
      : typeof first.timeMs === "number" && first.timeMs === second.timeMs);
  if (tied) return "Tie";
  return `${first.displayName} wins`;
}

export function rankedRacePlayers(): RacePlayer[] {
  const party = getRaceParty();
  const source =
    getStandings().length > 0 ? getStandings() : (party?.players ?? []);
  const timed = party?.settings?.mode === "time";
  return [...source].sort((a, b) => {
    if (timed) {
      const aScore = a.score ?? a.progress;
      const bScore = b.score ?? b.progress;
      if (bScore !== aScore) return bScore - aScore;
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
    <div class="mb-6">
      <p class="mb-3 text-2xl text-main">{resultHeadline()}</p>
      <ol class="flex flex-col gap-2">
        <For each={rankedRacePlayers()}>
          {(player, index) => (
            <li class="flex items-center justify-between rounded bg-bg px-3 py-2">
              <span>
                #{index() + 1} {player.displayName}
                <Show when={player.id === winnerId()}>
                  <span class="ml-2 text-xs text-main">winner</span>
                </Show>
              </span>
              <span class="text-sub">{scoreLabel(player)}</span>
            </li>
          )}
        </For>
      </ol>
    </div>
  );
}
