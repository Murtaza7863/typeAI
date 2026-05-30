type ChatJsonResult = {
  summary?: string;
  frequentMistakes?: {
    issue: string;
    evidence: string;
    fix: string;
  }[];
  strengths?: string[];
  practiceTips?: string[];
};

type LlmConfig = {
  provider: "openai-compatible" | "cursor-agent";
  apiKey: string;
  baseUrl: string;
  model: string;
};

function nonEmpty(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

const TYPING_COACH_JSON_SHAPE = `{
  "summary": string (2-3 sentences),
  "frequentMistakes": [{"issue": string, "evidence": string, "fix": string}] (max 5),
  "strengths": string[] (max 4),
  "practiceTips": string[] (max 4)
}`;

export function resolveLlmConfig(): LlmConfig | null {
  const cursorKey = process.env["CURSOR_API_KEY"]?.trim();
  const llmKey = process.env["LLM_API_KEY"]?.trim();
  const openaiKey = process.env["OPENAI_API_KEY"]?.trim();
  const providerEnv = process.env["LLM_PROVIDER"]?.trim().toLowerCase();

  if (providerEnv === "cursor" || providerEnv === "cursor-agent") {
    if (nonEmpty(cursorKey)) {
      return {
        provider: "cursor-agent",
        apiKey: cursorKey,
        baseUrl: "https://api.cursor.com",
        model: process.env["CURSOR_MODEL"] ?? "composer-2",
      };
    }
    return null;
  }

  if (
    nonEmpty(cursorKey) &&
    providerEnv !== "openai" &&
    !nonEmpty(llmKey) &&
    !nonEmpty(openaiKey)
  ) {
    return {
      provider: "cursor-agent",
      apiKey: cursorKey,
      baseUrl: "https://api.cursor.com",
      model: process.env["CURSOR_MODEL"] ?? "composer-2",
    };
  }

  const apiKey = llmKey ?? openaiKey ?? cursorKey;
  if (!nonEmpty(apiKey)) return null;

  if (apiKey.startsWith("crsr_") && providerEnv !== "openai") {
    return {
      provider: "cursor-agent",
      apiKey,
      baseUrl: "https://api.cursor.com",
      model: process.env["CURSOR_MODEL"] ?? "composer-2",
    };
  }

  const baseUrl = (
    process.env["LLM_BASE_URL"] ??
    process.env["OPENAI_BASE_URL"] ??
    "https://api.openai.com/v1"
  ).replace(/\/$/, "");

  return {
    provider: "openai-compatible",
    apiKey,
    baseUrl,
    model:
      process.env["LLM_MODEL"] ?? process.env["OPENAI_MODEL"] ?? "gpt-4o-mini",
  };
}

function basicAuthHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
}

async function openAiCompatibleJson(
  config: LlmConfig,
  systemPrompt: string,
  userPrompt: string,
): Promise<ChatJsonResult | null> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!nonEmpty(content)) return null;

  try {
    return JSON.parse(content) as ChatJsonResult;
  } catch {
    return null;
  }
}

function parseSseLine(
  line: string,
  state: { currentEvent: string; text: string },
): boolean {
  if (line.startsWith("event: ")) {
    state.currentEvent = line.slice(7).trim();
    return state.currentEvent === "done";
  }
  if (!line.startsWith("data: ")) return false;

  const raw = line.slice(6).trim();
  if (raw === "" || raw === "[DONE]") return false;

  if (state.currentEvent === "assistant") {
    try {
      const event = JSON.parse(raw) as { text?: string };
      if (typeof event.text === "string") state.text += event.text;
    } catch {
      // ignore malformed chunks
    }
  }

  if (state.currentEvent === "result") return true;

  return false;
}

async function readCursorAgentSseStream(streamRes: Response): Promise<string> {
  const body = streamRes.body;
  if (body === null) return "";

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const state = { currentEvent: "", text: "" };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (parseSseLine(line, state)) return state.text;
    }
  }

  return state.text;
}

async function cursorAgentJson(
  config: LlmConfig,
  systemPrompt: string,
  userPrompt: string,
): Promise<ChatJsonResult | null> {
  const auth = basicAuthHeader(config.apiKey);
  const fullPrompt = `${systemPrompt}\n\nUser stats JSON:\n${userPrompt}\n\nRespond with ONLY valid JSON matching:\n${TYPING_COACH_JSON_SHAPE}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const createRes = await fetch("https://api.cursor.com/v1/agents", {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: { text: fullPrompt },
        model: { id: config.model },
      }),
      signal: controller.signal,
    });

    if (!createRes.ok) return null;

    const created = (await createRes.json()) as {
      agent?: { id?: string };
      run?: { id?: string };
    };
    const agentId = created.agent?.id;
    const runId = created.run?.id;
    if (!nonEmpty(agentId) || !nonEmpty(runId)) return null;

    const streamRes = await fetch(
      `https://api.cursor.com/v1/agents/${agentId}/runs/${runId}/stream`,
      {
        headers: {
          Authorization: auth,
          Accept: "text/event-stream",
        },
        signal: controller.signal,
      },
    );

    if (!streamRes.ok) return null;

    const assistantText = await readCursorAgentSseStream(streamRes);
    if (assistantText === "") return null;

    const jsonMatch = /\{[\s\S]*\}/.exec(assistantText);
    if (jsonMatch === null) return null;

    return JSON.parse(jsonMatch[0]) as ChatJsonResult;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestTypingCoachJson(
  userPrompt: string,
): Promise<ChatJsonResult | null> {
  const config = resolveLlmConfig();
  if (!config) return null;

  const systemPrompt = `You are a typing coach analyzing typeAI test statistics.
Be specific, actionable, and encouraging. Reference the user's stats.
Do not invent per-key data that was not provided.`;

  if (config.provider === "cursor-agent") {
    return cursorAgentJson(config, systemPrompt, userPrompt);
  }

  const systemWithSchema = `${systemPrompt}
Respond ONLY with valid JSON matching this shape:
${TYPING_COACH_JSON_SHAPE}`;

  return openAiCompatibleJson(config, systemWithSchema, userPrompt);
}

export function usesCursorAgent(): boolean {
  return resolveLlmConfig()?.provider === "cursor-agent";
}
