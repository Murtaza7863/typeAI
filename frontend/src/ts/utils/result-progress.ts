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

export const DAILY_GOALS = {
  tests: 3,
  seconds: 10 * 60,
  drills: 1,
} as const;

const dailyDaySchema = z.object({
  tests: z.number(),
  totalWpm: z.number(),
  totalAcc: z.number(),
  seconds: z.number(),
  drills: z.number().default(0),
  recoveries: z.number().default(0),
  goalsCelebrated: z.boolean().default(false),
});

export type DailyDayProgress = z.infer<typeof dailyDaySchema>;

const dailyProgressStore = new LocalStorageWithSchema({
  key: "typeai-daily-progress",
  schema: z.record(z.string(), dailyDaySchema),
  fallback: {},
});

export type DailyGoalStatus = {
  id: "tests" | "minutes" | "drill";
  label: string;
  current: number;
  target: number;
  unit: string;
  complete: boolean;
};

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
    goals: DailyGoalStatus[];
    goalsComplete: number;
    goalsTotal: number;
    allGoalsComplete: boolean;
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

export type RecordDailyProgressOptions = {
  coachMode?: "original" | "adaptive" | "drill";
  recoveries?: number;
};

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

function normalizeDay(
  day: Partial<DailyDayProgress> | undefined,
): DailyDayProgress {
  return {
    tests: day?.tests ?? 0,
    totalWpm: day?.totalWpm ?? 0,
    totalAcc: day?.totalAcc ?? 0,
    seconds: day?.seconds ?? 0,
    drills: day?.drills ?? 0,
    recoveries: day?.recoveries ?? 0,
    goalsCelebrated: day?.goalsCelebrated ?? false,
  };
}

export function buildDailyGoals(day: DailyDayProgress): DailyGoalStatus[] {
  return [
    {
      id: "tests",
      label: "Complete tests",
      current: day.tests,
      target: DAILY_GOALS.tests,
      unit: "tests",
      complete: day.tests >= DAILY_GOALS.tests,
    },
    {
      id: "minutes",
      label: "Time typed",
      current: Math.floor(day.seconds / 60),
      target: DAILY_GOALS.seconds / 60,
      unit: "min",
      complete: day.seconds >= DAILY_GOALS.seconds,
    },
    {
      id: "drill",
      label: "Coach drill",
      current: day.drills,
      target: DAILY_GOALS.drills,
      unit: "session",
      complete: day.drills >= DAILY_GOALS.drills,
    },
  ];
}

/** Consecutive local days with at least one test (includes today if present). */
export function getLocalStreak(fromTs = Date.now()): number {
  const store = dailyProgressStore.get();
  let streak = 0;
  const cursor = new Date(fromTs);
  cursor.setHours(12, 0, 0, 0);

  for (let i = 0; i < 400; i++) {
    const key = formatDateKey(cursor.getTime());
    const day = store[key];
    if (day === undefined || day.tests <= 0) {
      if (i === 0) {
        cursor.setDate(cursor.getDate() - 1);
        continue;
      }
      break;
    }
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function recordDailyProgress(
  result: CompletedEvent,
  options: RecordDailyProgressOptions = {},
): {
  day: DailyDayProgress;
  goals: DailyGoalStatus[];
  justCompletedAllGoals: boolean;
} {
  const key = formatDateKey(result.timestamp);
  const data = dailyProgressStore.get();
  const prev = normalizeDay(data[key]);
  const typingSeconds = Math.max(
    0,
    result.testDuration + result.incompleteTestSeconds - result.afkDuration,
  );
  const isDrill =
    options.coachMode === "adaptive" || options.coachMode === "drill";

  const next = normalizeDay({
    tests: prev.tests + 1,
    totalWpm: prev.totalWpm + result.wpm,
    totalAcc: prev.totalAcc + result.acc,
    seconds: prev.seconds + typingSeconds,
    drills: prev.drills + (isDrill ? 1 : 0),
    recoveries: prev.recoveries + (options.recoveries ?? 0),
    goalsCelebrated: prev.goalsCelebrated,
  });

  const goals = buildDailyGoals(next);
  const allComplete = goals.every((goal) => goal.complete);
  const justCompletedAllGoals = allComplete && !prev.goalsCelebrated;
  if (justCompletedAllGoals) {
    next.goalsCelebrated = true;
  }

  data[key] = next;
  dailyProgressStore.set(data);

  return { day: next, goals, justCompletedAllGoals };
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
  const daily = normalizeDay(dailyProgressStore.get()[todayKey]);
  const todayStart = startOfDay(current.timestamp);
  const testsTodayFromDb = allResults.filter(
    (result) => startOfDay(result.timestamp) === todayStart,
  ).length;
  const testsToday = Math.max(daily.tests, testsTodayFromDb);
  const goals = buildDailyGoals({ ...daily, tests: testsToday });

  const snapshot = getSnapshot();
  const accountStreak =
    snapshot?.streak !== undefined && snapshot.streak > 0
      ? snapshot.streak
      : null;
  const localStreak = getLocalStreak(current.timestamp);
  const streak = accountStreak ?? (localStreak > 0 ? localStreak : null);

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
      typingLabel: formatTypingTime(daily.seconds),
      streak: streak !== null && streak > 0 ? streak : null,
      goals,
      goalsComplete: goals.filter((goal) => goal.complete).length,
      goalsTotal: goals.length,
      allGoalsComplete: goals.every((goal) => goal.complete),
    },
    trend,
    thisTestMistakes: formatMistakes(sessionMistakes),
    recoveryInsight,
    sparklineWpm,
    hasEnoughForTrend: sparklineSource.length >= 2,
  };
}
