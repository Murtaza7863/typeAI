import "dotenv/config";
import { requestTypingCoachJson } from "../src/services/llm-client";

const summary = JSON.stringify({
  testsAnalyzed: 3,
  avgWpm: 61,
  avgAcc: 85.7,
  avgConsistency: 69.3,
  totalIncorrect: 50,
  totalExtra: 23,
  totalMissed: 13,
  lateTestErrorRate: 0.5,
  earlyTestErrorRate: 0.2,
  incompleteTestRate: 0.33,
  weakestModes: [],
  weakestLanguages: [],
  recentWpmTrend: "stable",
});

async function main(): Promise<void> {
  console.log("Starting Cursor AI request...");
  const started = Date.now();
  const result = await requestTypingCoachJson(summary);
  console.log(`Elapsed ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(JSON.stringify(result, null, 2));
}

void main();
