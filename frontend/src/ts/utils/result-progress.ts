import { getFunbox } from "@typeai/funbox";
import { CompletedEvent } from "@typeai/schemas/results";
import { Mode } from "@typeai/schemas/shared";
import { z } from "zod";

import { __nonReactive } from "../collections/results";
import { SnapshotResult } from "../constants/default-snapshot";
import * as DB from "../db";
import { getSnapshot } from "../states/snapshot";
import { recoveryStrengthsFromProfile } from "../typing-feedback/mistake-insights";
import { SessionMistakeSnapshot } from "../typing-feedback/session-mistakes";
import { LocalStorageWithSchema } from "./local-storage-with-schema";

const dailyDaySchema = z.object({
  tests: z.number(),
  totalWpm: z.number(),
  totalAcc: z.number(),
  seconds: z.number(),
});

const dailyProgressStore = new LocalStorageWithSchema({
  key: "typeai-daily-progress",
  schema: z.record(z.string(), dailyDaySchema),
  fallback: {},
});

export type ProgressSnapshotData = {
  vsLastTest: {
    wpmDelta: number;
    accDelta: number;
    errDelta: number;
  } | null;
  vsLast10Avg: {
    wpmDelta: number;
    avgWpm: number;
  } | null;
  vsPb: {
    gap: number;
    pbWpm: number;
    isNewPb: boolean;
  } | null;
  today: {
    tests: number;
    typingLabel: string;
    streak: number | null;
  };
  trend: {
    currentWeekAvg: number;
    priorWeekAvg: number;
    delta: number;
  } | null;
  thisTestMistakes: string | null;
  recoveryInsight: string | null;
  sparklineWpm: number[];
  hasEnoughForTrend: boolean;
};

type ResultLike = CompletedEvent | SnapshotResult<Mode>;

function formatDateKey(ts: number): string {
  const d = new Date(ts);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function errorCount(result: ResultLike): number {
  const stats = result.charStats;
  return (stats[1] ?? 0) + (stats[2] ?? 0) + (stats[3] ?? 0);
}

function matchesSameConfig(a: ResultLike, b: ResultLike): boolean {
  return (
    a.mode === b.mode &&
    a.mode2 === b.mode2 &&
    a.language === b.language &&
    (a.punctuation ?? false) === (b.punctuation ?? false) &&
    (a.numbers ?? false) === (b.numbers ?? false) &&
    a.difficulty === b.difficulty
  );
}

function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function formatTypingTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function formatMistakes(snapshot: SessionMistakeSnapshot): string | null {
  const parts: string[] = [];

  for (const [key, count] of Object.entries(snapshot.bigrams)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)) {
    parts.push(`"${key}"×${count}`);
  }

  for (const [key, count] of Object.entries(snapshot.wrongLetters)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)) {
    parts.push(`letter "${key}"×${count}`);
  }

  return parts.length > 0 ? parts.join(", ") : null;
}

function weekAvgWpm(daysBackStart: number, daysBackEnd: number): number | null {
  const store = dailyProgressStore.get();
  const now = new Date();
  const wpms: number[] = [];

  for (let i = daysBackStart; i < daysBackEnd; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = formatDateKey(d.getTime());
    const day = store[key];
    if (day !== undefined && day.tests > 0) {
      wpms.push(day.totalWpm / day.tests);
    }
  }

  if (wpms.length === 0) return null;
  return average(wpms);
}

export function recordDailyProgress(result: CompletedEvent): void {
  const key = formatDateKey(result.timestamp);
  const data = dailyProgressStore.get();
  const prev = data[key] ?? { tests: 0, totalWpm: 0, totalAcc: 0, seconds: 0 };
  const typingSeconds = Math.max(
    0,
    result.testDuration + result.incompleteTestSeconds - result.afkDuration,
  );

  data[key] = {
    tests: prev.tests + 1,
    totalWpm: prev.totalWpm + result.wpm,
    totalAcc: prev.totalAcc + result.acc,
    seconds: prev.seconds + typingSeconds,
  };
  dailyProgressStore.set(data);
}

export async function buildProgressSnapshot(
  current: CompletedEvent,
  sessionMistakes: SessionMistakeSnapshot,
): Promise<ProgressSnapshotData> {
  const allResults = __nonReactive.getResults();
  const prior = allResults
    .filter((result) => result.timestamp < current.timestamp)
    .sort((a, b) => b.timestamp - a.timestamp);
  const sameConfigPrior = prior.filter((result) =>
    matchesSameConfig(result, current),
  );

  let vsLastTest: ProgressSnapshotData["vsLastTest"] = null;
  const last = sameConfigPrior[0];
  if (last !== undefined) {
    vsLastTest = {
      wpmDelta: current.wpm - last.wpm,
      accDelta: current.acc - last.acc,
      errDelta: errorCount(current) - errorCount(last),
    };
  }

  let vsLast10Avg: ProgressSnapshotData["vsLast10Avg"] = null;
  const last10 = sameConfigPrior.slice(0, 10);
  if (last10.length >= 3) {
    const avgWpm = average(last10.map((result) => result.wpm));
    vsLast10Avg = {
      wpmDelta: current.wpm - avgWpm,
      avgWpm,
    };
  }

  let vsPb: ProgressSnapshotData["vsPb"] = null;
  if (current.mode !== "quote") {
    const localPb = await DB.getLocalPB(
      current.mode,
      current.mode2,
      current.punctuation ?? false,
      current.numbers ?? false,
      current.language,
      current.difficulty,
      current.lazyMode ?? false,
      getFunbox(current.funbox ?? []),
    );
    const pbWpm = localPb?.wpm ?? 0;
    if (pbWpm > 0) {
      const gap = current.wpm - pbWpm;
      vsPb = {
        gap,
        pbWpm,
        isNewPb: gap > 0,
      };
    }
  }

  const todayKey = formatDateKey(current.timestamp);
  const daily = dailyProgressStore.get()[todayKey];
  const todayStart = startOfDay(current.timestamp);
  const testsTodayFromDb = allResults.filter(
    (result) => startOfDay(result.timestamp) === todayStart,
  ).length;
  const testsToday = Math.max(daily?.tests ?? 0, testsTodayFromDb);

  const snapshot = getSnapshot();
  const streak =
    snapshot?.streak !== undefined && snapshot.streak > 0
      ? snapshot.streak
      : null;

  const currentWeek = weekAvgWpm(0, 7);
  const priorWeek = weekAvgWpm(7, 14);
  let trend: ProgressSnapshotData["trend"] = null;
  if (currentWeek !== null && priorWeek !== null) {
    trend = {
      currentWeekAvg: currentWeek,
      priorWeekAvg: priorWeek,
      delta: currentWeek - priorWeek,
    };
  }

  const sparklineSource = sameConfigPrior.slice(0, 9).reverse();
  const sparklineWpm = [
    ...sparklineSource.map((result) => result.wpm),
    current.wpm,
  ];

  const recoveryStrengths = recoveryStrengthsFromProfile();
  const recoveryInsight =
    recoveryStrengths.find((entry) => entry.includes("Almost there")) ??
    recoveryStrengths[0] ??
    null;

  return {
    vsLastTest,
    vsLast10Avg,
    vsPb,
    today: {
      tests: testsToday,
      typingLabel: formatTypingTime(daily?.seconds ?? 0),
      streak,
    },
    trend,
    thisTestMistakes: formatMistakes(sessionMistakes),
    recoveryInsight,
    sparklineWpm,
    hasEnoughForTrend: sparklineSource.length >= 2,
  };
}
