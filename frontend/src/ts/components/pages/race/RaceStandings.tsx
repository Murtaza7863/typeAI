import { RacePlayer } from "@typeai/schemas/race";
import { For, JSXElement, Show } from "solid-js";

import { getRaceParty, getRaceYou, getStandings } from "../../../states/race";
import { cn } from "../../../utils/cn";
import { Fa } from "../../common/Fa";

function formatTime(timeMs: number | null | undefined): string {
  if (timeMs === null || timeMs === undefined) return "DNF";
  return `${(timeMs / 1000).toFixed(2)}s`;
}

function wpm(score: number, seconds: number): number {
  if (seconds <= 0) return 0;
  return Math.round(score / 5 / (seconds / 60));
}

function scoreLabel(player: RacePlayer): string {
  const party = getRaceParty();
  if (party?.settings?.mode === "time") {
    const seconds =
      (typeof player.timeMs === "number"
        ? player.timeMs
        : (party.settings.time ?? 30) * 1000) / 1000;
    if (typeof player.score === "number" && seconds > 0) {
      return `${wpm(player.score, seconds)} wpm · ${formatTime(player.timeMs)}`;
    }
    return `${player.progress}% · ${formatTime(player.timeMs)}`;
  }
  return formatTime(player.timeMs);
}

function isTie(): boolean {
  const ranked = rankedRacePlayers();
  const first = ranked[0];
  const second = ranked[1];
  if (first === undefined || second === undefined) return false;
  const timed = getRaceParty()?.settings?.mode === "time";
  if (timed) {
    return (
      (first.score ?? first.progress) === (second.score ?? second.progress)
    );
  }
  return typeof first.timeMs === "number" && first.timeMs === second.timeMs;
}

function resultHeadline(): string {
  const ranked = rankedRacePlayers();
  const first = ranked[0];
  if (first === undefined) return "Race complete";
  if (isTie()) return "It's a tie";
  if (first.id === getRaceYou()?.id) return "You win";
  return `${first.displayName} wins`;
}

function marginLine(): string | null {
  const ranked = rankedRacePlayers();
  const first = ranked[0];
  const second = ranked[1];
  if (first === undefined || second === undefined || isTie()) return null;
  const party = getRaceParty();
  if (party?.settings?.mode === "time") {
    const seconds = party.settings.time ?? 30;
    if (typeof first.score !== "number" || typeof second.score !== "number") {
      return null;
    }
    const gap = wpm(first.score, seconds) - wpm(second.score, seconds);
    if (gap <= 0) return null;
    return `${gap} wpm ahead`;
  }
  if (typeof first.timeMs === "number" && typeof second.timeMs === "number") {
    const gap = (second.timeMs - first.timeMs) / 1000;
    if (gap <= 0) return null;
    return `${gap.toFixed(2)}s ahead`;
  }
  return null;
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
  const youWon = (): boolean =>
    !isTie() && rankedRacePlayers()[0]?.id === getRaceYou()?.id;

  return (
    <div class="mb-6">
      <style>
        {
          "@keyframes race-win-pop{0%{transform:scale(.86);opacity:0}100%{transform:scale(1);opacity:1}}"
        }
      </style>
      <div
        class="mb-5 text-center"
        style={{ animation: "race-win-pop 420ms ease-out" }}
      >
        <Fa
          icon={
            youWon()
              ? "fa-trophy"
              : isTie()
                ? "fa-handshake"
                : "fa-flag-checkered"
          }
          class="mb-3 text-5xl text-main"
        />
        <p class="text-xs tracking-widest text-sub uppercase">Race complete</p>
        <p class="mt-1 text-5xl text-main">{resultHeadline()}</p>
        <Show when={marginLine()}>
          {(line) => <p class="mt-2 text-xl text-text">{line()}</p>}
        </Show>
      </div>
      <ol class="flex flex-col gap-2">
        <For each={rankedRacePlayers()}>
          {(player, index) => {
            const first = (): boolean => index() === 0 && !isTie();
            return (
              <li
                class={cn(
                  "flex items-center justify-between rounded px-3 py-2",
                  first()
                    ? "border border-main bg-bg py-4 text-lg"
                    : "bg-bg text-text",
                )}
              >
                <span>
                  <Show when={first()} fallback={<span>#{index() + 1} </span>}>
                    <Fa icon="fa-crown" class="mr-2 text-main" />
                  </Show>
                  {player.displayName}
                  <Show when={player.id === getRaceYou()?.id}>
                    <span class="ml-2 text-xs text-main">you</span>
                  </Show>
                  <Show
                    when={
                      player.id === winnerId() &&
                      resultHeadline() !== "It's a tie"
                    }
                  >
                    <span class="ml-2 text-xs text-main">winner</span>
                  </Show>
                </span>
                <span class={first() ? "text-main" : "text-sub"}>
                  {scoreLabel(player)}
                </span>
              </li>
            );
          }}
        </For>
      </ol>
    </div>
  );
}
