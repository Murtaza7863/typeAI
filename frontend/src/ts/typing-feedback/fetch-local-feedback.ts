import {
  TypingFeedback,
  TypingSessionInput,
} from "@typeai/schemas/typing-feedback";
import { raceHttpOrigin } from "../race/http-origin";
import { envConfig } from "virtual:env-config";

const LOCAL_FEEDBACK_TIMEOUT_MS = 20_000;

type LocalTypingFeedbackResponse = {
  message?: string;
  data?: TypingFeedback;
};

function resolveLocalFeedbackUrl(): string {
  const origin = raceHttpOrigin();
  if (origin === null) {
    throw new Error("Live coach is not configured");
  }
  return `${origin}/typing-feedback`;
}

export async function fetchLocalTypingFeedback(
  sessions: TypingSessionInput[],
): Promise<TypingFeedback> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error("request timed out"));
  }, LOCAL_FEEDBACK_TIMEOUT_MS);

  try {
    const response = await fetch(resolveLocalFeedbackUrl(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Client-Version": envConfig.clientVersion,
      },
      body: JSON.stringify({ sessions }),
      signal: controller.signal,
    });

    const body = (await response.json()) as LocalTypingFeedbackResponse;
    if (response.status !== 200 || body.data === undefined) {
      throw new Error(body.message ?? "Failed to load typing feedback");
    }
    return body.data;
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("request took too long to complete");
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}
