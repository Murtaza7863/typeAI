import {
  DEFAULT_RACE_SETTINGS,
  RaceMode,
  RaceSettings,
  RaceTime,
  RaceWordCount,
} from "@typeai/schemas/race";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  JSXElement,
  onCleanup,
  Show,
} from "solid-js";

import { navigate } from "../../../controllers/route-controller";
import {
  connectRaceWs,
  createParty,
  joinParty,
  onRaceMessage,
  playAgain,
  startRace,
  updateRaceSettings,
} from "../../../race/client";
import { leaveRaceAndRestore } from "../../../race/controller";
import { getActivePage } from "../../../states/core";
import { showErrorNotification } from "../../../states/notifications";
import {
  getCountdownSeconds,
  getLocalFinished,
  getRaceError,
  getRaceParty,
  getRaceSession,
  getRaceWsConnected,
  getRaceYou,
  setRaceError,
} from "../../../states/race";
import { Button } from "../../common/Button";
import { Fa } from "../../common/Fa";
import { RaceProgressBars } from "./RaceProgressBars";
import { RaceStandings } from "./RaceStandings";

const NAME_KEY = "typeai-race-display-name";
const WORD_COUNTS: RaceWordCount[] = [25, 50, 100];
const TIME_COUNTS: RaceTime[] = [15, 30, 60];
const RACE_MODES: { id: RaceMode; label: string }[] = [
  { id: "words", label: "Words" },
  { id: "time", label: "Time" },
  { id: "quote", label: "Quote" },
];

function loadSavedName(): string {
  return localStorage.getItem(NAME_KEY) ?? "";
}

function saveName(name: string): void {
  localStorage.setItem(NAME_KEY, name);
}

function settingsFromParty(settings: RaceSettings | undefined): RaceSettings {
  return {
    mode: settings?.mode ?? DEFAULT_RACE_SETTINGS.mode,
    wordCount: settings?.wordCount ?? DEFAULT_RACE_SETTINGS.wordCount,
    time: settings?.time ?? DEFAULT_RACE_SETTINGS.time,
    punctuation: settings?.punctuation ?? DEFAULT_RACE_SETTINGS.punctuation,
  };
}

function settingsSummary(settings: RaceSettings): string {
  if (settings.mode === "quote") {
    return "Quote race";
  }
  const punct = settings.punctuation ? " · punctuation" : "";
  if (settings.mode === "time") {
    return `${settings.time}s${punct}`;
  }
  return `${settings.wordCount} words${punct}`;
}

function RacePartyPanel(props: {
  displayName: () => string;
  draftSettings: () => RaceSettings;
  inviteUrl: () => string;
  settingsControls: (editable: boolean) => JSXElement;
  copyInvite: () => Promise<void>;
}): JSXElement {
  const partyData = () => getRaceParty();
  const you = () => getRaceYou();
  const playerCount = (): number => partyData()?.players.length ?? 0;
  const liveSettings = (): RaceSettings =>
    settingsFromParty(partyData()?.settings);

  return (
    <div class="flex flex-col gap-6">
      <Show when={partyData()?.status === "lobby"}>
        <div class="bg-bg-2 rounded-lg border border-sub/30 p-6">
          <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div class="text-sm text-sub">Party code</div>
              <div class="text-3xl tracking-widest text-main">
                {partyData()?.code}
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <Button
                text="Copy invite link"
                variant="text"
                onClick={() => void props.copyInvite()}
              />
              <Button
                text="Leave"
                variant="text"
                onClick={() => {
                  leaveRaceAndRestore();
                  void navigate("/");
                }}
              />
            </div>
          </div>

          <p class="mb-2 text-xs break-all text-sub">{props.inviteUrl()}</p>

          <div class="mb-6 rounded bg-bg px-3 py-3">
            <div class="mb-3 text-sm text-sub">
              Race settings · {settingsSummary(liveSettings())}
            </div>
            <Show
              when={you()?.isHost}
              fallback={
                <p class="text-sm text-text">
                  {settingsSummary(liveSettings())}
                </p>
              }
            >
              {props.settingsControls(true)}
            </Show>
          </div>

          <h2 class="mb-3 text-sm text-sub">Players ({playerCount()}/8)</h2>
          <ul class="mb-6 flex flex-col gap-2">
            <For each={partyData()?.players ?? []}>
              {(player) => (
                <li class="flex items-center justify-between rounded bg-bg px-3 py-2">
                  <span>
                    {player.displayName}
                    <Show when={player.isHost}>
                      <span class="ml-2 text-xs text-sub">host</span>
                    </Show>
                    <Show when={player.id === you()?.id}>
                      <span class="ml-2 text-xs text-main">you</span>
                    </Show>
                  </span>
                  <span class="text-xs text-sub">
                    {player.connected ? "online" : "offline"}
                  </span>
                </li>
              )}
            </For>
          </ul>

          <Show
            when={you()?.isHost}
            fallback={<p class="text-sub">Waiting for host to start…</p>}
          >
            <Button
              text="Start race"
              disabled={playerCount() < 2}
              onClick={() => startRace(props.draftSettings())}
            />
            <Show when={playerCount() < 2}>
              <p class="mt-2 text-xs text-sub">
                Need at least 2 players to start. Share the invite link and keep
                this page open.
              </p>
            </Show>
          </Show>
        </div>
      </Show>

      <Show when={partyData()?.status === "countdown"}>
        <div class="bg-bg-2 rounded-lg border border-sub/30 p-10 text-center">
          <div class="text-sm text-sub">Race starting in</div>
          <div class="text-6xl text-main">{getCountdownSeconds() ?? "Go"}</div>
          <Button
            class="mt-6"
            text="Leave"
            variant="text"
            onClick={() => {
              leaveRaceAndRestore();
              void navigate("/race");
            }}
          />
        </div>
      </Show>

      <Show when={partyData()?.status === "racing"}>
        <div class="bg-bg-2 rounded-lg border border-sub/30 p-6">
          <Show
            when={getLocalFinished()}
            fallback={
              <p class="mb-4 text-sub">
                Race in progress — switch to the typing test if it didn&apos;t
                open automatically.
              </p>
            }
          >
            <p class="mb-4 text-main">
              You finished! Waiting for other players…
            </p>
          </Show>
          <RaceProgressBars />
          <div class="mt-4 flex flex-wrap gap-2">
            <Button
              text="Open typing test"
              variant="text"
              onClick={() => void navigate("/")}
            />
            <Button
              text="Leave race"
              variant="text"
              onClick={() => {
                leaveRaceAndRestore();
                void navigate("/race");
              }}
            />
          </div>
        </div>
      </Show>

      <Show when={partyData()?.status === "finished"}>
        <div class="bg-bg-2 rounded-lg border border-sub/30 p-6">
          <h2 class="mb-4 text-xl text-main">Race complete</h2>
          <RaceStandings />
          <div class="flex flex-wrap gap-2">
            <Show when={you()?.isHost}>
              <Button text="Play again" onClick={() => playAgain()} />
            </Show>
            <Show when={!you()?.isHost}>
              <p class="w-full text-sm text-sub">
                Waiting for the host to start another race, or leave.
              </p>
            </Show>
            <Button
              text="Leave"
              variant="text"
              onClick={() => {
                leaveRaceAndRestore();
                void navigate("/");
              }}
            />
          </div>
        </div>
      </Show>
    </div>
  );
}

export function RacePage(): JSXElement {
  const isOpen = (): boolean => getActivePage() === "race";
  const [displayName, setDisplayName] = createSignal(loadSavedName());
  const [joinCode, setJoinCode] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [draftSettings, setDraftSettings] = createSignal<RaceSettings>({
    ...DEFAULT_RACE_SETTINGS,
  });

  const party = createMemo(() => getRaceParty());
  const you = createMemo(() => getRaceYou());
  const inviteUrl = createMemo(() => {
    const p = party();
    if (p?.inviteUrl !== undefined && p.inviteUrl.length > 0) {
      return p.inviteUrl;
    }
    if (p === null) return "";
    return `${window.location.origin}/race/${p.code}`;
  });

  createEffect(() => {
    const p = party();
    if (p?.settings !== undefined) {
      setDraftSettings(settingsFromParty(p.settings));
    }
  });

  createEffect(() => {
    if (!isOpen()) return;

    void connectRaceWs()
      .then(() => {
        const path = window.location.pathname;
        const match = /^\/race\/([A-Za-z0-9]+)$/i.exec(path);
        const session = getRaceSession();
        const name = (localStorage.getItem(NAME_KEY) ?? "").trim() || "Player";
        setDisplayName((current) =>
          current.trim().length === 0 ? name : current,
        );
        const pathCode = match?.[1];
        if (pathCode !== undefined && pathCode.length > 0) {
          setJoinCode((current) => (current.length === 0 ? pathCode : current));
          if (getRaceParty() === null) {
            setBusy(true);
            void joinParty(pathCode, name, session?.playerId).finally(() => {
              setBusy(false);
            });
          }
        } else if (getRaceParty() === null && session !== null) {
          setBusy(true);
          void joinParty(session.code, name, session.playerId).finally(() => {
            setBusy(false);
          });
        }
      })
      .catch(() => {
        setRaceError("Could not connect to race server");
      });

    const unsub = onRaceMessage((message) => {
      if (message.type === "error") {
        showErrorNotification(message.message);
        setBusy(false);
      }
      if (message.type === "partyState") {
        setBusy(false);
      }
    });
    onCleanup(unsub);
  });

  const copyInvite = async (): Promise<void> => {
    const url = inviteUrl();
    if (url.length === 0) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // ignore
    }
  };

  const ensureName = (): string | null => {
    const name = displayName().trim();
    if (name.length === 0) {
      setRaceError("Enter a display name");
      return null;
    }
    saveName(name);
    return name;
  };

  const patchSettings = (patch: Partial<RaceSettings>): void => {
    const next = { ...draftSettings(), ...patch };
    setDraftSettings(next);
    if (party() !== null && you()?.isHost) {
      updateRaceSettings(next);
    }
  };

  const onCreate = async (): Promise<void> => {
    const name = ensureName();
    if (name === null) return;
    setBusy(true);
    try {
      await connectRaceWs();
      await createParty(name, draftSettings());
    } finally {
      setBusy(false);
    }
  };

  const onJoin = async (): Promise<void> => {
    const name = ensureName();
    if (name === null) return;
    const code = joinCode().trim() || codeFromPath();
    if (code.length === 0) {
      setRaceError("Enter a party code");
      return;
    }
    setBusy(true);
    try {
      await connectRaceWs();
      await joinParty(code, name, getRaceSession()?.playerId);
    } finally {
      setBusy(false);
    }
  };

  const codeFromPath = (): string => {
    const match = /^\/race\/([A-Za-z0-9]+)$/i.exec(window.location.pathname);
    return match?.[1] ?? "";
  };

  const settingsControls = (editable: boolean): JSXElement => (
    <div class="flex flex-col gap-4">
      <div>
        <div class="mb-2 text-sm text-sub">Mode</div>
        <div class="flex flex-wrap gap-2">
          <For each={RACE_MODES}>
            {(mode) => (
              <Button
                text={mode.label}
                variant="text"
                active={draftSettings().mode === mode.id}
                disabled={!editable}
                onClick={() => patchSettings({ mode: mode.id })}
              />
            )}
          </For>
        </div>
      </div>

      <Show when={draftSettings().mode === "time"}>
        <div>
          <div class="mb-2 text-sm text-sub">Duration</div>
          <div class="flex flex-wrap gap-2">
            <For each={TIME_COUNTS}>
              {(seconds) => (
                <Button
                  text={`${seconds}s`}
                  variant="text"
                  active={draftSettings().time === seconds}
                  disabled={!editable}
                  onClick={() => patchSettings({ time: seconds })}
                />
              )}
            </For>
          </div>
        </div>
      </Show>

      <Show when={draftSettings().mode === "words"}>
        <div>
          <div class="mb-2 text-sm text-sub">Word count</div>
          <div class="flex flex-wrap gap-2">
            <For each={WORD_COUNTS}>
              {(count) => (
                <Button
                  text={`${count}`}
                  variant="text"
                  active={draftSettings().wordCount === count}
                  disabled={!editable}
                  onClick={() => patchSettings({ wordCount: count })}
                />
              )}
            </For>
          </div>
        </div>
      </Show>

      <Show
        when={
          draftSettings().mode === "words" || draftSettings().mode === "time"
        }
      >
        <div>
          <div class="mb-2 text-sm text-sub">Punctuation</div>
          <div class="flex flex-wrap gap-2">
            <Button
              text="Off"
              variant="text"
              active={!draftSettings().punctuation}
              disabled={!editable}
              onClick={() => patchSettings({ punctuation: false })}
            />
            <Button
              text="On"
              variant="text"
              active={draftSettings().punctuation}
              disabled={!editable}
              onClick={() => patchSettings({ punctuation: true })}
            />
          </div>
        </div>
      </Show>
    </div>
  );

  return (
    <Show when={isOpen()}>
      <div class="mx-auto flex w-full max-w-180 flex-col gap-8 p-4">
        <div class="flex items-center gap-3">
          <Fa icon="fa-flag-checkered" class="text-2xl text-main" />
          <div>
            <h1 class="text-2xl text-text">Competitive</h1>
            <p class="text-sm text-sub">
              Race a friend on the same test — words, timed, or a quote. First
              to finish wins timed races by progress. Keep this tab open while
              friends join.
            </p>
          </div>
        </div>

        <Show when={getRaceError()}>
          {(err) => <p class="text-error">{err()}</p>}
        </Show>

        <Show
          when={party()}
          fallback={
            <div class="bg-bg-2 flex flex-col gap-6 rounded-lg border border-sub/30 p-6">
              <label class="flex flex-col gap-2">
                <span class="text-sm text-sub">Display name</span>
                <input
                  class="rounded border border-sub/40 bg-bg px-3 py-2 text-text"
                  value={displayName()}
                  maxLength={24}
                  placeholder="Your name"
                  onInput={(e) => setDisplayName(e.currentTarget.value)}
                />
              </label>

              {settingsControls(true)}

              <div class="flex flex-wrap gap-3">
                <Button
                  text="Create party"
                  disabled={busy() || !getRaceWsConnected()}
                  onClick={() => void onCreate()}
                />
              </div>

              <div class="border-t border-sub/20 pt-4">
                <label class="mb-2 flex flex-col gap-2">
                  <span class="text-sm text-sub">Join with code</span>
                  <input
                    class="rounded border border-sub/40 bg-bg px-3 py-2 text-text uppercase"
                    value={joinCode() || codeFromPath()}
                    maxLength={8}
                    placeholder="XK9M2A"
                    onInput={(e) => setJoinCode(e.currentTarget.value)}
                  />
                </label>
                <Button
                  text="Join party"
                  variant="text"
                  disabled={busy() || !getRaceWsConnected()}
                  onClick={() => void onJoin()}
                />
              </div>

              <Show when={!getRaceWsConnected()}>
                <p class="text-xs text-sub">Connecting to the race lobby…</p>
              </Show>
            </div>
          }
        >
          <RacePartyPanel
            displayName={displayName}
            draftSettings={draftSettings}
            inviteUrl={inviteUrl}
            settingsControls={settingsControls}
            copyInvite={copyInvite}
          />
        </Show>
      </div>
    </Show>
  );
}
