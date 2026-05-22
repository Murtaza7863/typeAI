import {
  TypingFeedback,
  TypingFeedbackMistake,
  TypingSessionInput,
} from "@monkeytype/schemas/typing-feedback";
import { ChartData } from "@monkeytype/schemas/results";

const MIN_TESTS = 3;
const MAX_RESULTS = 50;

type TypingFeedbackSummary = {
  testsAnalyzed: number;
  avgWpm: number;
  avgAcc: number;
  avgConsistency: number;
  totalIncorrect: number;
  totalExtra: number;
  totalMissed: number;
  lateTestErrorRate: number;
  earlyTestErrorRate: number;
  incompleteTestRate: number;
  slowKeySpacingSd: number;
  inconsistentKeyDurationSd: number;
  weakestModes: { label: string; avgAcc: number; count: number }[];
  weakestLanguages: { label: string; avgAcc: number; count: number }[];
  recentWpmTrend: "improving" | "declining" | "stable";
};

function round(n: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function chartErrorRates(chartData: ChartData | "toolong" | undefined): {
  early: number;
  late: number;
} {
  if (chartData === undefined || chartData === "toolong") {
    return { early: 0, late: 0 };
  }
  const err = chartData.err;
  if (err.length === 0) return { early: 0, late: 0 };
  const mid = Math.max(1, Math.floor(err.length / 2));
  const earlySlice = err.slice(0, mid);
  const lateSlice = err.slice(mid);
  return {
    early: avg(earlySlice),
    late: avg(lateSlice),
  };
}

function buildSummary(sessions: TypingSessionInput[]): TypingFeedbackSummary {
  const wpms: number[] = [];
  const accs: number[] = [];
  const consistencies: number[] = [];
  let totalIncorrect = 0;
  let totalExtra = 0;
  let totalMissed = 0;
  let earlyErrorSum = 0;
  let lateErrorSum = 0;
  let chartCount = 0;
  let incompleteCount = 0;
  const keySpacingSds: number[] = [];
  const keyDurationSds: number[] = [];

  const modeAcc = new Map<string, { sum: number; count: number }>();
  const languageAcc = new Map<string, { sum: number; count: number }>();

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
    if (r.chartData !== undefined && r.chartData !== "toolong") chartCount += 1;

    if (
      (r.incompleteTests !== undefined && r.incompleteTests.length > 0) ||
      (r.incompleteTestSeconds !== undefined && r.incompleteTestSeconds > 0) ||
      (r.restartCount !== undefined && r.restartCount > 0)
    ) {
      incompleteCount += 1;
    }
    if (r.keySpacingStats?.sd !== undefined) {
      keySpacingSds.push(r.keySpacingStats.sd);
    }
    if (r.keyDurationStats?.sd !== undefined) {
      keyDurationSds.push(r.keyDurationStats.sd);
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
  let recentWpmTrend: TypingFeedbackSummary["recentWpmTrend"] = "stable";
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
    slowKeySpacingSd: round(avg(keySpacingSds), 1),
    inconsistentKeyDurationSd: round(avg(keyDurationSds), 1),
    weakestModes,
    weakestLanguages,
    recentWpmTrend,
  };
}

function buildRuleBasedFeedback(
  summary: TypingFeedbackSummary,
): TypingFeedback {
  const mistakes: TypingFeedbackMistake[] = [];
  const strengths: string[] = [];
  const practiceTips: string[] = [];

  if (summary.totalExtra > summary.totalIncorrect * 0.4) {
    mistakes.push({
      issue: "Overtyping (extra characters)",
      evidence: `${summary.totalExtra} extra characters vs ${summary.totalIncorrect} incorrect across recent tests.`,
      fix: "Pause briefly before pressing the next key when you feel unsure. Practice at slightly lower speed until extra keys drop.",
    });
  }

  if (summary.totalMissed > summary.totalIncorrect * 0.35) {
    mistakes.push({
      issue: "Skipped or missed characters",
      evidence: `${summary.totalMissed} missed characters in your recent history.`,
      fix: "Use lookahead: keep your eyes one word ahead and trust muscle memory for the current word instead of rushing ahead.",
    });
  }

  if (summary.lateTestErrorRate > summary.earlyTestErrorRate + 0.15) {
    mistakes.push({
      issue: "Accuracy drops as tests go on",
      evidence: `Late-test error rate (${summary.lateTestErrorRate}/s) is higher than early (${summary.earlyTestErrorRate}/s).`,
      fix: "Take a 10-second micro-break between long sessions. Try 60s tests focusing on holding accuracy in the last 20 seconds.",
    });
  }

  if (summary.incompleteTestRate > 0.15) {
    mistakes.push({
      issue: "Frequent restarts or abandoned tests",
      evidence: `${round(summary.incompleteTestRate * 100)}% of recent tests had incomplete attempts.`,
      fix: "Finish tests even when a run feels bad—completed data helps you learn. Restart only after the result saves.",
    });
  }

  for (const mode of summary.weakestModes) {
    if (mode.avgAcc < summary.avgAcc - 3) {
      mistakes.push({
        issue: `Weaker performance in ${mode.label}`,
        evidence: `Average ${mode.avgAcc}% accuracy over ${mode.count} tests (overall ${summary.avgAcc}%).`,
        fix: `Run 5–10 focused ${mode.label} tests at 10–15 WPM below your max, prioritizing accuracy over speed.`,
      });
    }
  }

  for (const lang of summary.weakestLanguages) {
    if (lang.avgAcc < summary.avgAcc - 3) {
      mistakes.push({
        issue: `Weaker accuracy on ${lang.label}`,
        evidence: `${lang.avgAcc}% average over ${lang.count} tests.`,
        fix: `Practice ${lang.label} in short 15–30s bursts until accuracy matches your other languages.`,
      });
    }
  }

  if (summary.avgAcc >= 97) {
    strengths.push(
      `Strong accuracy (${summary.avgAcc}%) across ${summary.testsAnalyzed} tests.`,
    );
  } else if (summary.avgAcc >= 94) {
    strengths.push(
      `Solid accuracy at ${summary.avgAcc}%—room to push speed safely.`,
    );
  }

  if (summary.recentWpmTrend === "improving") {
    strengths.push(
      "Your recent WPM trend is improving—keep building on that momentum.",
    );
  }

  if (summary.avgConsistency >= 80) {
    strengths.push(
      `Good rhythm: ${summary.avgConsistency}% consistency on average.`,
    );
  }

  if (mistakes.length === 0) {
    practiceTips.push(
      "No major patterns flagged—try pushing WPM by 5% while keeping accuracy above 95%.",
    );
  } else {
    practiceTips.push(
      "Pick one mistake pattern and drill it for a single session before moving to the next.",
    );
  }

  if (summary.recentWpmTrend === "declining") {
    practiceTips.push(
      "Recent speed dipped—run two easy accuracy-focused tests before chasing PBs.",
    );
  }

  return {
    ready: true,
    testsAnalyzed: summary.testsAnalyzed,
    minTestsRequired: MIN_TESTS,
    generatedAt: Date.now(),
    summary: `Based on ${summary.testsAnalyzed} tests: ${summary.avgWpm} WPM average, ${summary.avgAcc}% accuracy, ${summary.avgConsistency}% consistency.`,
    frequentMistakes: mistakes.slice(0, 5),
    strengths: strengths.slice(0, 4),
    practiceTips: practiceTips.slice(0, 4),
    poweredByAi: false,
    source: "local",
  };
}

export function computeRuleBasedTypingFeedback(
  sessions: TypingSessionInput[],
): TypingFeedback {
  if (sessions.length < MIN_TESTS) {
    return {
      ready: false,
      testsAnalyzed: sessions.length,
      minTestsRequired: MIN_TESTS,
      source: "local",
    };
  }

  const recentSessions = sessions.slice(-MAX_RESULTS);
  const summary = buildSummary(recentSessions);
  return buildRuleBasedFeedback(summary);
}
