import { createSignal, For, JSXElement, Show } from "solid-js";

import {
  dailyNicknameValid,
  DailyEntry,
  fetchDailyBoard,
  postDailyScore,
  readDailyNickname,
  saveDailyNickname,
} from "../../../daily/client";
import { createEffectOn } from "../../../hooks/effects";
import { raceHttpOrigin } from "../../../race/http-origin";
import { getTestProgressContext, getResultVisible } from "../../../states/test";
import { Button } from "../../common/Button";
import { Fa } from "../../common/Fa";

function modeLabel(entry: DailyEntry): string {
  return `${entry.mode} ${entry.mode2}`.trim();
}

export function DailyBoard(props: { variant: "result" | "page" }): JSXElement {
  const [nickname, setNickname] = createSignal(readDailyNickname());
  const [entries, setEntries] = createSignal<DailyEntry[]>([]);
  const [configured, setConfigured] = createSignal(true);
  const [message, setMessage] = createSignal("");
  const [posting, setPosting] = createSignal(false);

  const live = (): boolean => raceHttpOrigin() !== null;
  const visible = (): boolean => props.variant === "page" || getResultVisible();

  const load = async (): Promise<void> => {
    if (!live()) {
      setConfigured(false);
      setEntries([]);
      return;
    }
    try {
      const board = await fetchDailyBoard();
      setConfigured(board.configured);
      setEntries(board.entries);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not load board",
      );
    }
  };

  createEffectOn(visible, (show) => {
    if (!show) return;
    void load();
  });

  const post = async (): Promise<void> => {
    const name = nickname().trim();
    const context = getTestProgressContext();
    if (!dailyNicknameValid(name)) {
      setMessage("Use 2-16 letters or numbers.");
      return;
    }
    saveDailyNickname(name);
    if (context === null) {
      setMessage("Finish a test before posting.");
      return;
    }
    setPosting(true);
    setMessage("");
    try {
      const board = await postDailyScore({
        nickname: name,
        wpm: context.completedEvent.wpm,
        acc: context.completedEvent.acc,
        mode: context.completedEvent.mode,
        mode2: String(context.completedEvent.mode2),
      });
      setConfigured(board.configured);
      setEntries(board.entries);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not post score",
      );
    } finally {
      setPosting(false);
    }
  };

  return (
    <Show when={visible()}>
      <div class="mx-auto mt-6 w-full max-w-240 rounded-xl border border-main/20 bg-sub-alt/50 p-6 text-text">
        <div class="mb-4 flex items-center justify-between gap-4">
          <h3 class="flex items-center gap-2 text-lg">
            <span class="inline-flex size-8 items-center justify-center rounded-lg bg-main/15 text-main">
              <Fa icon="fa-list-ol" />
            </span>
            <span>Today</span>
          </h3>
          <Show when={props.variant === "result"}>
            <Button
              href="/daily"
              router-link
              text="Full board"
              variant="text"
            />
          </Show>
        </div>

        <Show
          when={live() && configured()}
          fallback={
            <p class="text-sm text-sub">
              The daily board is not connected yet. Add the Redis database on
              the live server, then refresh.
            </p>
          }
        >
          <div class="flex flex-col gap-4">
            <label class="flex flex-col gap-2">
              <span class="text-sm text-sub">Nickname</span>
              <input
                class="rounded border border-sub/40 bg-bg px-3 py-2 text-text"
                maxLength={16}
                placeholder="Your name"
                value={nickname()}
                onInput={(event) => {
                  setNickname(event.currentTarget.value);
                  setMessage("");
                }}
              />
            </label>
            <Show when={props.variant === "result"}>
              <Button
                disabled={posting()}
                onClick={() => {
                  void post();
                }}
                text={posting() ? "Posting…" : "Post this test"}
              />
            </Show>
            <Show when={message() !== ""}>
              <p class="text-sm text-error">{message()}</p>
            </Show>
            <Show
              when={entries().length > 0}
              fallback={<p class="text-sm text-sub">No scores yet today.</p>}
            >
              <ol class="flex flex-col gap-2">
                <For each={entries()}>
                  {(entry, index) => (
                    <li class="flex items-baseline justify-between gap-4 text-sm">
                      <span>
                        {index() + 1}. {entry.nickname}
                      </span>
                      <span class="text-sub">
                        {Math.round(entry.wpm)} wpm · {entry.acc.toFixed(0)}% ·{" "}
                        {modeLabel(entry)}
                      </span>
                    </li>
                  )}
                </For>
              </ol>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  );
}
