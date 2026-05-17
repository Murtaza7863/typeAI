import { z } from "zod";
import { ChartDataSchema, CharStatsSchema, KeyStatsSchema } from "./results";
import { LanguageSchema } from "./languages";
import { Mode2Schema, ModeSchema } from "./shared";

export const TypingSessionInputSchema = z.object({
  wpm: z.number().nonnegative(),
  acc: z.number(),
  consistency: z.number(),
  charStats: CharStatsSchema,
  mode: ModeSchema,
  mode2: Mode2Schema,
  language: LanguageSchema.optional(),
  chartData: ChartDataSchema.or(z.literal("toolong")).optional(),
  restartCount: z.number().int().nonnegative().optional(),
  incompleteTestSeconds: z.number().nonnegative().optional(),
  incompleteTests: z
    .array(z.object({ acc: z.number(), seconds: z.number().nonnegative() }))
    .optional(),
  keySpacingStats: KeyStatsSchema.optional(),
  keyDurationStats: KeyStatsSchema.optional(),
});
export type TypingSessionInput = z.infer<typeof TypingSessionInputSchema>;

export const TypingFeedbackMistakeSchema = z.object({
  issue: z.string(),
  evidence: z.string(),
  fix: z.string(),
});
export type TypingFeedbackMistake = z.infer<typeof TypingFeedbackMistakeSchema>;

export const TypingFeedbackSchema = z.object({
  ready: z.boolean(),
  testsAnalyzed: z.number().int().nonnegative(),
  minTestsRequired: z.number().int().positive(),
  generatedAt: z.number().int().nonnegative().optional(),
  summary: z.string().optional(),
  frequentMistakes: z.array(TypingFeedbackMistakeSchema).optional(),
  strengths: z.array(z.string()).optional(),
  practiceTips: z.array(z.string()).optional(),
  poweredByAi: z.boolean().optional(),
  poweredByCursor: z.boolean().optional(),
  source: z.enum(["account", "local"]).optional(),
});
export type TypingFeedback = z.infer<typeof TypingFeedbackSchema>;
