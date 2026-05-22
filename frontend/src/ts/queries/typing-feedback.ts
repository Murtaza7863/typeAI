import { TypingFeedback } from "@monkeytype/schemas/typing-feedback";
import { queryOptions } from "@tanstack/solid-query";
import Ape from "../ape";
import { isAuthenticated } from "../states/core";
import { computeRuleBasedTypingFeedback } from "../typing-feedback/compute-rule-based-feedback";
import { fetchLocalTypingFeedback } from "../typing-feedback/fetch-local-feedback";
import {
  getLocalTypingHistoryVersion,
  getLocalTypingSessions,
} from "../typing-feedback/local-history";
import { baseKey } from "./utils/keys";
import { queryClient } from "../queries";

export const typingFeedbackQueryKey = (): unknown[] => [
  ...baseKey("typingFeedback", { isUserSpecific: true }),
  isAuthenticated() ? "account" : "local",
];

// oxlint-disable-next-line explicit-function-return-type
export function getTypingFeedbackQueryOptions(options?: {
  enabled?: boolean;
  refresh?: boolean;
}) {
  const localHistoryVersion = getLocalTypingHistoryVersion();
  return queryOptions({
    queryKey: [
      ...typingFeedbackQueryKey(),
      getLocalTypingSessions().length,
      localHistoryVersion,
    ],
    queryFn: async (): Promise<TypingFeedback> => {
      if (isAuthenticated()) {
        const response = await Ape.users.getTypingFeedback({
          query: options?.refresh ? { refresh: "true" } : {},
        });
        if (response.status !== 200) {
          throw new Error(response.body.message);
        }
        return response.body.data;
      }

      const sessions = getLocalTypingSessions();
      try {
        return await fetchLocalTypingFeedback(sessions);
      } catch {
        return computeRuleBasedTypingFeedback(sessions);
      }
    },
    enabled: options?.enabled ?? true,
    staleTime: 60 * 60 * 1000,
  });
}

export function invalidateTypingFeedback(): void {
  void queryClient.invalidateQueries({
    queryKey: [...baseKey("typingFeedback", { isUserSpecific: true })],
  });
}
