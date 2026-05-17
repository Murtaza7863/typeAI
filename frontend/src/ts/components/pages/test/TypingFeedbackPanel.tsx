import { useQuery } from "@tanstack/solid-query";
import { createMemo, For, JSXElement, Show } from "solid-js";

import {
  getTypingFeedbackQueryOptions,
  invalidateTypingFeedback,
} from "../../../queries/typing-feedback";
import { isAuthenticated } from "../../../states/core";
import { getResultVisible } from "../../../states/test";
import {
  clearLocalTypingHistory,
  getLocalTypingHistoryVersion,
  getLocalTypingSessionCount,
} from "../../../typing-feedback/local-history";
import { showNoticeNotification } from "../../../states/notifications";
import { cn } from "../../../utils/cn";
import AsyncContent from "../../common/AsyncContent";
import { Button } from "../../common/Button";
import { Fa } from "../../common/Fa";

export function TypingFeedbackPanel(props: {
  variant?: "result" | "account";
}): JSXElement {
  const variant = (): "result" | "account" => props.variant ?? "account";

  const localSessionCount = createMemo(() => {
    getLocalTypingHistoryVersion();
    return getLocalTypingSessionCount();
  });

  const enabled = createMemo(() => {
    if (variant() === "account") {
      return true;
    }
    return getResultVisible();
  });

  const showResetHistory = (): boolean =>
    !isAuthenticated() && localSessionCount() > 0;

  const query = useQuery(() => ({
    ...getTypingFeedbackQueryOptions({ enabled: enabled() }),
  }));

  const resetLocalHistory = (): void => {
    clearLocalTypingHistory();
    invalidateTypingFeedback();
    void query.refetch();
    showNoticeNotification("Coach history cleared on this device.", {
      durationMs: 3000,
    });
  };

  return (
    <div
      class={cn(
        "rounded-lg border border-sub/30 bg-bg-2 text-text",
        variant() === "result" ? "mx-auto mt-6 max-w-240 p-6" : "p-6",
      )}
    >
      <div class="mb-4 flex items-center justify-between gap-4">
        <div>
          <h3 class="flex items-center gap-2 text-lg text-sub">
            <Fa icon="fa-robot" />
            <span>Typing coach</span>
          </h3>
          <Show when={!isAuthenticated()}>
            <p class="mt-1 text-xs text-sub">
              Using tests saved on this device. Sign in to sync history across
              devices.
            </p>
          </Show>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <Show when={showResetHistory()}>
            <Button
              variant="text"
              text="Reset history"
              disabled={query.isFetching}
              onClick={resetLocalHistory}
            />
          </Show>
          <Show when={query.data?.ready}>
            <Button
              variant="text"
              text="Refresh"
              disabled={query.isFetching}
              onClick={() => {
                invalidateTypingFeedback();
                void query.refetch();
              }}
            />
          </Show>
        </div>
      </div>

      <AsyncContent queries={{ query }}>
        {({ queryData }) => {
          const data = queryData();

          return (
            <Show
              when={data.ready}
              fallback={
                <p class="text-sub">
                  Complete{" "}
                  <span class="text-text">
                    {data.minTestsRequired - data.testsAnalyzed}
                  </span>{" "}
                  more saved tests to unlock personalized feedback. (
                  {data.testsAnalyzed}/{data.minTestsRequired})
                </p>
              }
            >
              <div class="flex flex-col gap-4">
                <Show when={data.poweredByAi}>
                  <p class="text-xs text-sub">
                    {data.poweredByCursor
                      ? "Enhanced with Cursor AI"
                      : "Enhanced with AI"}
                  </p>
                </Show>
                <Show when={data.summary}>
                  <p class="leading-relaxed">{data.summary}</p>
                </Show>

                <Show when={(data.frequentMistakes?.length ?? 0) > 0}>
                  <div>
                    <h4 class="mb-2 text-sm font-medium text-sub">
                      Frequent patterns
                    </h4>
                    <ul class="flex flex-col gap-3">
                      <For each={data.frequentMistakes ?? []}>
                        {(mistake) => (
                          <li class="rounded-md bg-bg p-4">
                            <div class="mb-1 font-medium">{mistake.issue}</div>
                            <p class="mb-2 text-sm text-sub">{mistake.evidence}</p>
                            <p class="text-sm">
                              <span class="text-sub">Fix: </span>
                              {mistake.fix}
                            </p>
                          </li>
                        )}
                      </For>
                    </ul>
                  </div>
                </Show>

                <Show when={(data.strengths?.length ?? 0) > 0}>
                  <div>
                    <h4 class="mb-2 text-sm font-medium text-sub">Strengths</h4>
                    <ul class="list-inside list-disc text-sm text-sub">
                      <For each={data.strengths ?? []}>
                        {(item) => <li>{item}</li>}
                      </For>
                    </ul>
                  </div>
                </Show>

                <Show when={(data.practiceTips?.length ?? 0) > 0}>
                  <div>
                    <h4 class="mb-2 text-sm font-medium text-sub">
                      Practice tips
                    </h4>
                    <ul class="list-inside list-disc text-sm text-sub">
                      <For each={data.practiceTips ?? []}>
                        {(item) => <li>{item}</li>}
                      </For>
                    </ul>
                  </div>
                </Show>
              </div>
            </Show>
          );
        }}
      </AsyncContent>
    </div>
  );
}