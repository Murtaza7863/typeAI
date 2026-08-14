import * as PageController from "./page-controller";
import * as TestUI from "../test/test-ui";
import * as PageTransition from "../legacy-states/page-transition";
import { isAuthAvailable } from "../firebase";
import { isAuthenticated } from "../states/core";
import { isFunboxActive } from "../test/funbox/list";
import * as TestState from "../test/test-state";
import { showNoticeNotification } from "../states/notifications";
import { navigationEvent, type NavigateOptions } from "../events/navigation";
import { authEvent } from "../events/auth";
import { ACCOUNTS_ENABLED } from "../constants/features";
import { envConfig } from "virtual:env-config";

//source: https://www.youtube.com/watch?v=OstALBk-jTc
// https://www.youtube.com/watch?v=OstALBk-jTc

function pathToRegex(path: string): RegExp {
  return new RegExp(`^${path.replace(/\//g, "\\/").replace(/:\w+/g, "(.+)")}$`);
}

function getParams(match: {
  route: Route;
  result: RegExpMatchArray;
}): Record<string, string> {
  const values = match.result.slice(1);
  const keys = Array.from(match.route.path.matchAll(/:(\w+)/g)).map(
    (result) => result[1],
  );

  const a = keys.map((key, index) => [key, values[index]]);
  return Object.fromEntries(a) as Record<string, string>;
}

type Route = {
  path: string;
  load: (
    params: Record<string, string>,
    navigateOptions: NavigateOptions,
  ) => Promise<void>;
};

function isAllowedLitePath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/verify" ||
    pathname === "/race" ||
    pathname.startsWith("/race/") ||
    pathname === "/settings"
  );
}

function isAccountPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/account" ||
    pathname === "/account-settings" ||
    pathname === "/friends" ||
    pathname === "/profile" ||
    pathname.startsWith("/profile/")
  );
}

function notifyAuthUnavailable(): void {
  showNoticeNotification(
    "Sign-in is not available on this deployment — Firebase config is missing. Set FIREBASE_CONFIG (or firebase-config.ts) and redeploy.",
    { important: true, durationMs: 8000 },
  );
}

const route404: Route = {
  path: "404",
  load: async (_params, options) => {
    await PageController.change("404", options);
  },
};

// NOTE: whenever adding a route add the pathname to the `firebase.json` rewrite rule
const routes: Route[] = [
  {
    path: "/",
    load: async (_params, options) => {
      await PageController.change("test", options);
    },
  },
  {
    path: "/verify",
    load: async (_params, options) => {
      await PageController.change("test", options);
    },
  },
  {
    path: "/leaderboards",
    load: async (_params, options) => {
      await PageController.change("leaderboards", options);
    },
  },
  {
    path: "/about",
    load: async (_params, options) => {
      await PageController.change("about", options);
    },
  },
  {
    path: "/settings",
    load: async (_params, options) => {
      await PageController.change("settings", options);
    },
  },
  {
    path: "/login",
    load: async (_params, options) => {
      if (!isAuthAvailable()) {
        notifyAuthUnavailable();
        await navigate("/", options);
        return;
      }
      if (isAuthenticated()) {
        await navigate("/account", options);
        return;
      }
      await PageController.change("login", options);
    },
  },
  {
    path: "/account",
    load: async (_params, options) => {
      if (!isAuthAvailable()) {
        notifyAuthUnavailable();
        await navigate("/", options);
        return;
      }
      if (!isAuthenticated()) {
        await navigate("/login", options);
        return;
      }
      await PageController.change("account", options);
    },
  },
  {
    path: "/account-settings",
    load: async (_params, options) => {
      if (!isAuthAvailable()) {
        notifyAuthUnavailable();
        await navigate("/", options);
        return;
      }
      if (!isAuthenticated()) {
        await navigate("/login", options);
        return;
      }
      await PageController.change("accountSettings", options);
    },
  },
  {
    path: "/profile",
    load: async (_params, options) => {
      await PageController.change("profileSearch", options);
    },
  },
  {
    path: "/profile/:uidOrName",
    load: async (params, options) => {
      await PageController.change("profile", {
        ...options,
        force: true,
        params: {
          uidOrName: params["uidOrName"] as string,
        },
        data: options.data,
      });
    },
  },
  {
    path: "/friends",
    load: async (_params, options) => {
      if (!isAuthAvailable()) {
        await navigate("/", options);
        return;
      }
      if (!isAuthenticated()) {
        await navigate("/login", options);
        return;
      }

      await PageController.change("friends", options);
    },
  },
  {
    path: "/race",
    load: async (_params, options) => {
      await PageController.change("race", options);
    },
  },
  {
    path: "/race/:code",
    load: async (_params, options) => {
      await PageController.change("race", options);
    },
  },
];

export async function navigate(
  url = window.location.pathname +
    window.location.search +
    window.location.hash,
  options = {} as NavigateOptions,
): Promise<void> {
  if (
    !options.force &&
    (TestState.testRestarting ||
      TestUI.resultCalculating ||
      PageTransition.get())
  ) {
    console.debug(
      `navigate: ${url} ignored, page is busy (testRestarting: ${
        TestState.testRestarting
      }, resultCalculating: ${
        TestUI.resultCalculating
      }, pageTransition: ${PageTransition.get()})`,
    );
    return;
  }

  const noQuit = isFunboxActive("no_quit");
  if (TestState.isActive && noQuit) {
    showNoticeNotification(
      "No quit funbox is active. Please finish the test.",
      {
        important: true,
      },
    );
    //todo: figure out if this was ever used
    // event?.preventDefault();
    return;
  }

  url = url.replace(/\/$/, "");
  if (url === "") url = "/";

  if (!ACCOUNTS_ENABLED) {
    const accountTarget = new URL(url, window.location.origin);
    if (isAccountPath(accountTarget.pathname)) {
      url = "/";
    }
  }

  if (envConfig.liteMode) {
    const targetUrl = new URL(url, window.location.origin);
    if (!isAllowedLitePath(targetUrl.pathname)) {
      url = "/";
    }
  }

  // only push to history if we're navigating to a different URL
  const currentUrl = new URL(window.location.href);
  const targetUrl = new URL(url, window.location.origin);

  if (
    currentUrl.pathname + currentUrl.search + currentUrl.hash !==
    targetUrl.pathname + targetUrl.search + targetUrl.hash
  ) {
    history.pushState(null, "", url);
  }

  await router(options);
}

async function router(options = {} as NavigateOptions): Promise<void> {
  const matches = routes.map((r) => {
    return {
      route: r,
      result: location.pathname.match(pathToRegex(r.path)),
    };
  });

  const match = matches.find((m) => m.result !== null) as {
    route: Route;
    result: RegExpMatchArray;
  };

  if (match === undefined) {
    await route404.load(
      {},
      {
        force: true,
      },
    );
    return;
  }

  await match.route.load(getParams(match), options);
}

window.addEventListener("popstate", () => {
  void router();
});

document.addEventListener("DOMContentLoaded", () => {
  document.body.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const link = target.closest("a[router-link]");
    if (!(link instanceof HTMLAnchorElement) || !link.href) return;
    e.preventDefault();
    void navigate(link.href);
  });
});

navigationEvent.subscribe(({ url, options }) => {
  void navigate(url, options);
});

authEvent.subscribe((event) => {
  if (event.type === "authStateChanged") {
    let keyframes = [
      {
        percentage: 90,
        durationMs: 1000,
        text: "Downloading user data...",
      },
    ];

    //undefined means navigate to whatever the current window.location.pathname is
    void navigate(undefined, {
      force: true,
      loadingOptions: {
        loadingMode: () => {
          if (event.data.isUserSignedIn) {
            return "sync";
          } else {
            return "none";
          }
        },
        loadingPromise: async () => {
          await event.data.loadPromise;
        },
        style: "bar",
        keyframes: keyframes,
      },
    }).finally(() => {
      document.body.classList.remove("loading");
    });
  }
});
