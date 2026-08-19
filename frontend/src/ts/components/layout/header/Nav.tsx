import { createMemo, JSXElement, Show } from "solid-js";
import { envConfig } from "virtual:env-config";

import { restartTestEvent } from "../../../events/test";
import {
  prefetchAboutPage,
  prefetchLeaderboardPage,
} from "../../../queries/prefetch";
import { getActivePage } from "../../../states/core";
import { showModal } from "../../../states/modals";
import { getSnapshot } from "../../../states/snapshot";
import { getFocus } from "../../../states/test";
import { cn } from "../../../utils/cn";
import { Button } from "../../common/Button";
import { NotificationBubble } from "../../common/NotificationBubble";

function NavLabel(props: { text: string }): JSXElement {
  return (
    <span class="hidden text-xs tracking-wide xl:inline">{props.text}</span>
  );
}

export function Nav(): JSXElement {
  const isLiteMode = () => envConfig.liteMode;

  const buttonClass = () =>
    cn("aspect-square xl:aspect-auto xl:px-3", {
      "opacity-(--nav-focus-opacity)": getFocus(),
    });

  const showAlertsNotificationBubble = createMemo((): boolean => {
    const snapshot = getSnapshot();
    if (snapshot === undefined) return false;
    return snapshot.inboxUnreadSize > 0;
  });

  return (
    <nav class={cn("z-5 flex w-full items-center gap-1 md:gap-2")}>
      <Button
        variant="text"
        fa={{
          icon: "fa-keyboard",
          fixedWidth: true,
        }}
        router-link
        href="/"
        class={buttonClass()}
        dataset={{
          "data-nav-item": "test",
        }}
        onClick={() => {
          if (getActivePage() === "test") restartTestEvent.dispatch();
        }}
      >
        <NavLabel text="test" />
      </Button>
      <Show when={!isLiteMode()}>
        <>
          <Button
            variant="text"
            fa={{
              icon: "fa-crown",
              fixedWidth: true,
            }}
            router-link
            dataset={{
              "data-nav-item": "leaderboards",
            }}
            class={buttonClass()}
            href="/leaderboards"
            onMouseEnter={() => {
              prefetchLeaderboardPage();
            }}
          >
            <NavLabel text="leaderboards" />
          </Button>
          <Button
            variant="text"
            fa={{
              icon: "fa-info",
              fixedWidth: true,
            }}
            class={buttonClass()}
            dataset={{
              "data-nav-item": "about",
            }}
            href="/about"
            router-link
            onMouseEnter={() => {
              prefetchAboutPage();
            }}
          >
            <NavLabel text="about" />
          </Button>
          <Button
            variant="text"
            fa={{
              icon: "fa-bell",
              fixedWidth: true,
            }}
            dataset={{
              "data-nav-item": "alerts",
            }}
            onClick={() => {
              showModal("Alerts");
            }}
            class={cn(buttonClass(), "relative")}
          >
            <NavLabel text="alerts" />
            <NotificationBubble
              variant="fromCorner"
              show={showAlertsNotificationBubble()}
            />
          </Button>
        </>
      </Show>
      <Button
        variant="text"
        fa={{
          icon: "fa-flag-checkered",
          fixedWidth: true,
        }}
        router-link
        dataset={{
          "data-nav-item": "competitive",
        }}
        class={buttonClass()}
        href="/race"
      >
        <NavLabel text="race" />
      </Button>
      <Button
        variant="text"
        fa={{
          icon: "fa-cog",
          fixedWidth: true,
        }}
        class={buttonClass()}
        href="/settings"
        dataset={{
          "data-nav-item": "settings",
        }}
        router-link
      >
        <NavLabel text="settings" />
      </Button>
      <div class="grow"></div>
    </nav>
  );
}
