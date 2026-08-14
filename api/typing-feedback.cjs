/* generated from api/_lib/handler.ts — run node scripts/bundle-api.mjs */
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if ((from && typeof from === "object") || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, {
          get: () => from[key],
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
        });
  }
  return to;
};
var __toCommonJS = (mod) =>
  __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../../Users/murtazakuvawala/Downloads/typeAI/api/_lib/handler.ts
var handler_exports = {};
__export(handler_exports, {
  default: () => handler,
});
module.exports = __toCommonJS(handler_exports);

// ../../Users/murtazakuvawala/Downloads/typeAI/api/_lib/typing-coach.ts
var MAX_RESULTS = 50;
var TYPING_COACH_JSON_SHAPE = `{
  "summary": string (2-3 sentences),
  "frequentMistakes": [{"issue": string, "evidence": string, "fix": string}] (max 5),
  "strengths": string[] (max 4),
  "practiceTips": string[] (max 4)
}`;
function minTestsRequired() {
  const parsed = Number.parseInt(
    process.env["TYPING_FEEDBACK_MIN_TESTS"] ?? "3",
    10,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}
function round(n, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}
function avg(nums) {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
function chartErrorRates(chartData) {
  if (chartData === void 0 || chartData === "toolong") {
    return { early: 0, late: 0 };
  }
  const err = chartData.err;
  if (err.length === 0) return { early: 0, late: 0 };
  const mid = Math.max(1, Math.floor(err.length / 2));
  return {
    early: avg(err.slice(0, mid)),
    late: avg(err.slice(mid)),
  };
}
function buildSummary(sessions) {
  const wpms = [];
  const accs = [];
  const consistencies = [];
  let totalIncorrect = 0;
  let totalExtra = 0;
  let totalMissed = 0;
  let earlyErrorSum = 0;
  let lateErrorSum = 0;
  let chartCount = 0;
  let incompleteCount = 0;
  const modeAcc = /* @__PURE__ */ new Map();
  const languageAcc = /* @__PURE__ */ new Map();
  for (const r of sessions) {
    wpms.push(r.wpm);
    accs.push(r.acc);
    consistencies.push(r.consistency);
    totalIncorrect += r.charStats[1];
    totalExtra += r.charStats[2];
    totalMissed += r.charStats[3];
    const modeKey = `${r.mode}/${r.mode2}`;
    const modeEntry = modeAcc.get(modeKey) ?? { sum: 0, count: 0 };
    modeEntry.sum += r.acc;
    modeEntry.count += 1;
    modeAcc.set(modeKey, modeEntry);
    const language = r.language ?? "english";
    const langEntry = languageAcc.get(language) ?? { sum: 0, count: 0 };
    langEntry.sum += r.acc;
    langEntry.count += 1;
    languageAcc.set(language, langEntry);
    const rates = chartErrorRates(r.chartData);
    earlyErrorSum += rates.early;
    lateErrorSum += rates.late;
    if (r.chartData !== void 0 && r.chartData !== "toolong") chartCount += 1;
    if (
      (r.incompleteTests !== void 0 && r.incompleteTests.length > 0) ||
      (r.incompleteTestSeconds !== void 0 && r.incompleteTestSeconds > 0) ||
      (r.restartCount !== void 0 && r.restartCount > 0)
    ) {
      incompleteCount += 1;
    }
  }
  const weakestModes = [...modeAcc.entries()]
    .filter(([, v]) => v.count >= 3)
    .map(([label, v]) => ({
      label,
      avgAcc: round(v.sum / v.count, 1),
      count: v.count,
    }))
    .sort((a, b) => a.avgAcc - b.avgAcc)
    .slice(0, 3);
  const weakestLanguages = [...languageAcc.entries()]
    .filter(([, v]) => v.count >= 3)
    .map(([label, v]) => ({
      label,
      avgAcc: round(v.sum / v.count, 1),
      count: v.count,
    }))
    .sort((a, b) => a.avgAcc - b.avgAcc)
    .slice(0, 3);
  const recent = wpms.slice(0, Math.min(10, wpms.length));
  const older = wpms.slice(10, Math.min(20, wpms.length));
  let recentWpmTrend = "stable";
  if (recent.length >= 5 && older.length >= 5) {
    const recentAvg = avg(recent);
    const olderAvg = avg(older);
    if (recentAvg > olderAvg + 2) recentWpmTrend = "improving";
    else if (recentAvg < olderAvg - 2) recentWpmTrend = "declining";
  }
  return {
    testsAnalyzed: sessions.length,
    avgWpm: round(avg(wpms), 1),
    avgAcc: round(avg(accs), 1),
    avgConsistency: round(avg(consistencies), 1),
    totalIncorrect,
    totalExtra,
    totalMissed,
    lateTestErrorRate: chartCount > 0 ? round(lateErrorSum / chartCount, 2) : 0,
    earlyTestErrorRate:
      chartCount > 0 ? round(earlyErrorSum / chartCount, 2) : 0,
    incompleteTestRate: round(incompleteCount / sessions.length, 2),
    weakestModes,
    weakestLanguages,
    recentWpmTrend,
  };
}
function buildRuleBasedFeedback(summary) {
  const mistakes = [];
  const strengths = [];
  const practiceTips = [];
  const minTests = minTestsRequired();
  if (summary.totalExtra > summary.totalIncorrect * 0.4) {
    mistakes.push({
      issue: "Overtyping (extra characters)",
      evidence: `${summary.totalExtra} extra characters vs ${summary.totalIncorrect} incorrect across recent tests.`,
      fix: "Pause briefly before pressing the next key when you feel unsure.",
    });
  }
  if (summary.totalMissed > summary.totalIncorrect * 0.35) {
    mistakes.push({
      issue: "Skipped or missed characters",
      evidence: `${summary.totalMissed} missed characters in your recent history.`,
      fix: "Keep your eyes one word ahead and trust muscle memory for the current word.",
    });
  }
  if (summary.lateTestErrorRate > summary.earlyTestErrorRate + 0.15) {
    mistakes.push({
      issue: "Accuracy drops as tests go on",
      evidence: `Late-test error rate (${summary.lateTestErrorRate}/s) is higher than early (${summary.earlyTestErrorRate}/s).`,
      fix: "Take a short break between long sessions; try 60s tests focused on the last 20 seconds.",
    });
  }
  for (const mode of summary.weakestModes) {
    if (mode.avgAcc < summary.avgAcc - 3) {
      mistakes.push({
        issue: `Weaker performance in ${mode.label}`,
        evidence: `Average ${mode.avgAcc}% accuracy over ${mode.count} tests (overall ${summary.avgAcc}%).`,
        fix: `Run focused ${mode.label} tests at 10\u201315 WPM below your max.`,
      });
    }
  }
  if (summary.avgAcc >= 97) {
    strengths.push(
      `Strong accuracy (${summary.avgAcc}%) across ${summary.testsAnalyzed} tests.`,
    );
  } else if (summary.avgAcc >= 94) {
    strengths.push(`Solid accuracy at ${summary.avgAcc}%.`);
  }
  if (summary.recentWpmTrend === "improving") {
    strengths.push("Your recent WPM trend is improving.");
  }
  if (mistakes.length === 0) {
    practiceTips.push(
      "No major patterns flagged\u2014try pushing WPM by 5% while keeping accuracy above 95%.",
    );
  } else {
    practiceTips.push(
      "Drill one mistake pattern per session before moving on.",
    );
  }
  return {
    ready: true,
    testsAnalyzed: summary.testsAnalyzed,
    minTestsRequired: minTests,
    generatedAt: Date.now(),
    summary: `Based on ${summary.testsAnalyzed} tests: ${summary.avgWpm} WPM average, ${summary.avgAcc}% accuracy, ${summary.avgConsistency}% consistency.`,
    frequentMistakes: mistakes.slice(0, 5),
    strengths: strengths.slice(0, 4),
    practiceTips: practiceTips.slice(0, 4),
    poweredByAi: false,
    source: "local",
  };
}
var COACH_SYSTEM_PROMPT = `You are a typing coach analyzing typeAI test statistics.
Be specific, actionable, and encouraging. Reference the user's stats.
Do not invent per-key data that was not provided.`;
function resolveOpenAiConfig() {
  const apiKey =
    process.env["OPENAI_API_KEY"]?.trim() || process.env["LLM_API_KEY"]?.trim();
  if (!apiKey) return null;
  const baseUrl = (
    process.env["LLM_BASE_URL"] ??
    process.env["OPENAI_BASE_URL"] ??
    "https://api.openai.com/v1"
  ).replace(/\/$/, "");
  return {
    apiKey,
    baseUrl,
    model:
      process.env["LLM_MODEL"] ?? process.env["OPENAI_MODEL"] ?? "gpt-4o-mini",
  };
}
function resolveCursorConfig() {
  const apiKey = process.env["CURSOR_API_KEY"]?.trim();
  if (!apiKey?.startsWith("crsr_")) return null;
  return {
    apiKey,
    model: process.env["CURSOR_MODEL"] ?? "composer-2",
  };
}
function basicAuthHeader(apiKey) {
  const bytes = new TextEncoder().encode(`${apiKey}:`);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `Basic ${btoa(binary)}`;
}
async function openAiCompatibleJson(userPrompt) {
  const config = resolveOpenAiConfig();
  if (!config) return null;
  const systemPrompt = `${COACH_SYSTEM_PROMPT}
Respond ONLY with valid JSON matching this shape:
${TYPING_COACH_JSON_SHAPE}`;
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
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}
function parseSseLine(line, state) {
  if (line.startsWith("event: ")) {
    state.currentEvent = line.slice(7).trim();
    return state.currentEvent === "done";
  }
  if (!line.startsWith("data: ")) return false;
  const raw = line.slice(6).trim();
  if (raw === "" || raw === "[DONE]") return false;
  if (state.currentEvent === "assistant") {
    try {
      const event = JSON.parse(raw);
      if (typeof event.text === "string") state.text += event.text;
    } catch {}
  }
  return state.currentEvent === "result";
}
async function readCursorAgentSseStream(streamRes) {
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
async function cursorAgentJson(userPrompt) {
  const config = resolveCursorConfig();
  if (!config) return null;
  const auth = basicAuthHeader(config.apiKey);
  const fullPrompt = `${COACH_SYSTEM_PROMPT}

User stats JSON:
${userPrompt}

Respond with ONLY valid JSON matching:
${TYPING_COACH_JSON_SHAPE}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55e3);
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
    const created = await createRes.json();
    const agentId = created.agent?.id;
    const runId = created.run?.id;
    if (!agentId || !runId) return null;
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
    const jsonMatch = assistantText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
async function requestTypingCoachJson(userPrompt) {
  const openAi = await openAiCompatibleJson(userPrompt);
  if (openAi !== null) {
    return { parsed: openAi, poweredByCursor: false };
  }
  const cursor = await cursorAgentJson(userPrompt);
  return { parsed: cursor, poweredByCursor: cursor !== null };
}
async function enhanceWithLlm(summary, base) {
  const { parsed, poweredByCursor } = await requestTypingCoachJson(
    JSON.stringify(summary, null, 2),
  );
  if (parsed === null) return base;
  return {
    ...base,
    summary: parsed.summary ?? base.summary,
    frequentMistakes: parsed.frequentMistakes ?? base.frequentMistakes,
    strengths: parsed.strengths ?? base.strengths,
    practiceTips: parsed.practiceTips ?? base.practiceTips,
    poweredByAi: true,
    poweredByCursor: poweredByCursor ? true : void 0,
  };
}
async function getTypingFeedbackFromSessions(sessions) {
  const minTests = minTestsRequired();
  const source = "local";
  if (sessions.length < minTests) {
    return {
      ready: false,
      testsAnalyzed: sessions.length,
      minTestsRequired: minTests,
      source,
    };
  }
  const recentSessions = sessions.slice(-MAX_RESULTS);
  const summary = buildSummary(recentSessions);
  let feedback = buildRuleBasedFeedback(summary);
  feedback = await enhanceWithLlm(summary, feedback);
  return { ...feedback, source };
}

// ../../Users/murtazakuvawala/Downloads/typeAI/api/_lib/handler.ts
function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, X-Client-Version",
  );
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}
async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, X-Client-Version",
  );
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { message: "Method not allowed", data: null });
    return;
  }
  let body = {};
  try {
    if (typeof req.body === "string") {
      body = JSON.parse(req.body);
    } else if (req.body !== void 0 && req.body !== null) {
      body = req.body;
    }
  } catch {
    sendJson(res, 400, { message: "Invalid JSON body", data: null });
    return;
  }
  if (!Array.isArray(body.sessions)) {
    sendJson(res, 400, { message: "sessions array is required", data: null });
    return;
  }
  try {
    const feedback = await getTypingFeedbackFromSessions(body.sessions);
    sendJson(res, 200, {
      message: "Typing feedback generated",
      data: feedback,
    });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to generate typing feedback";
    sendJson(res, 500, { message, data: null });
  }
}
if (typeof module.exports.default === "function") {
  module.exports = module.exports.default;
}
