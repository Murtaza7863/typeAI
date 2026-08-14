import { afterEach, describe, expect, it } from "vitest";

const memory = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string): string | null => memory.get(key) ?? null,
  setItem: (key: string, value: string): void => {
    memory.set(key, value);
  },
  removeItem: (key: string): void => {
    memory.delete(key);
  },
  clear: (): void => {
    memory.clear();
  },
  key: (): string | null => null,
  get length(): number {
    return memory.size;
  },
};

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: localStorageMock,
});
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: localStorageMock,
});

const { profileHasDrillData, recordSessionToProfile, clearMistakeProfile } =
  await import("../../src/ts/typing-feedback/mistake-profile");

describe("mistake profile drill unlock", () => {
  afterEach(() => {
    memory.clear();
    clearMistakeProfile();
  });

  it("stays locked until a weakness is seen at least twice", () => {
    recordSessionToProfile({
      wrongLetters: { e: 1 },
      typedInstead: {},
      bigrams: {},
      missedWords: {},
    });
    expect(profileHasDrillData()).toBe(false);

    recordSessionToProfile({
      wrongLetters: { e: 1 },
      typedInstead: {},
      bigrams: {},
      missedWords: {},
    });
    expect(profileHasDrillData()).toBe(true);
  });
});
