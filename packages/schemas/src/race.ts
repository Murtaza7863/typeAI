import { z } from "zod";

export const RacePartyStatusSchema = z.enum([
  "lobby",
  "countdown",
  "racing",
  "finished",
]);
export type RacePartyStatus = z.infer<typeof RacePartyStatusSchema>;

export const RaceModeSchema = z.enum(["words", "quote", "time"]);
export type RaceMode = z.infer<typeof RaceModeSchema>;

export const RaceWordCountSchema = z.union([
  z.literal(25),
  z.literal(50),
  z.literal(100),
]);
export type RaceWordCount = z.infer<typeof RaceWordCountSchema>;

export const RaceTimeSchema = z.union([
  z.literal(15),
  z.literal(30),
  z.literal(60),
]);
export type RaceTime = z.infer<typeof RaceTimeSchema>;

export const RaceSettingsSchema = z.object({
  mode: RaceModeSchema.default("words"),
  wordCount: RaceWordCountSchema.default(50),
  time: RaceTimeSchema.default(30),
  punctuation: z.boolean().default(false),
});
export type RaceSettings = z.infer<typeof RaceSettingsSchema>;

export const DEFAULT_RACE_SETTINGS: RaceSettings = {
  mode: "words",
  wordCount: 50,
  time: 30,
  punctuation: false,
};

export const RacePlayerSchema = z.object({
  id: z.string(),
  displayName: z.string().min(1).max(24),
  progress: z.number().min(0).max(100),
  finishedAt: z.number().nullable().optional(),
  timeMs: z.number().nullable().optional(),
  connected: z.boolean(),
  isHost: z.boolean(),
});
export type RacePlayer = z.infer<typeof RacePlayerSchema>;

export const RacePartyStateSchema = z.object({
  code: z.string(),
  status: RacePartyStatusSchema,
  hostId: z.string(),
  words: z.array(z.string()),
  settings: RaceSettingsSchema.optional(),
  players: z.array(RacePlayerSchema),
  inviteUrl: z.string().optional(),
  startedAt: z.number().nullable().optional(),
  countdownEndsAt: z.number().nullable().optional(),
  winnerId: z.string().nullable().optional(),
});
export type RacePartyState = z.infer<typeof RacePartyStateSchema>;

export const RaceClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("createParty"),
    displayName: z.string().min(1).max(24),
    settings: RaceSettingsSchema.optional(),
  }),
  z.object({
    type: z.literal("joinParty"),
    code: z.string().min(4).max(8),
    displayName: z.string().min(1).max(24),
    playerId: z.string().optional(),
  }),
  z.object({
    type: z.literal("updateSettings"),
    settings: RaceSettingsSchema,
  }),
  z.object({
    type: z.literal("startRace"),
    settings: RaceSettingsSchema.optional(),
  }),
  z.object({
    type: z.literal("progress"),
    progress: z.number().min(0).max(100),
  }),
  z.object({
    type: z.literal("finished"),
    timeMs: z.number().positive(),
  }),
  z.object({
    type: z.literal("leave"),
  }),
  z.object({
    type: z.literal("reconnect"),
    code: z.string().min(4).max(8),
    playerId: z.string(),
  }),
]);
export type RaceClientMessage = z.infer<typeof RaceClientMessageSchema>;

export const RaceServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("partyState"),
    party: RacePartyStateSchema,
    you: RacePlayerSchema,
  }),
  z.object({
    type: z.literal("countdown"),
    endsAt: z.number(),
    seconds: z.number(),
  }),
  z.object({
    type: z.literal("raceStart"),
    startedAt: z.number(),
    words: z.array(z.string()),
    settings: RaceSettingsSchema.optional(),
  }),
  z.object({
    type: z.literal("progressUpdate"),
    playerId: z.string(),
    progress: z.number(),
  }),
  z.object({
    type: z.literal("playerFinished"),
    playerId: z.string(),
    timeMs: z.number(),
    place: z.number(),
    standings: z.array(RacePlayerSchema),
  }),
  z.object({
    type: z.literal("raceComplete"),
    winnerId: z.string().nullable(),
    standings: z.array(RacePlayerSchema),
  }),
  z.object({
    type: z.literal("error"),
    message: z.string(),
  }),
]);
export type RaceServerMessage = z.infer<typeof RaceServerMessageSchema>;

export const RACE_WORD_COUNT = 50;
export const RACE_MAX_PLAYERS = 8;
export const RACE_COUNTDOWN_SECONDS = 3;
export const RACE_FINISH_TIMEOUT_MS = 60_000;
export const RACE_HARD_TIMEOUT_MS = 10 * 60 * 1000;
