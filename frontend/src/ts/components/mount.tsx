import { QueryClientProvider } from "@tanstack/solid-query";
import { JSXElement } from "solid-js";
import { render } from "solid-js/web";
import { envConfig } from "virtual:env-config";

import { queryClient } from "../queries";
import { qsa } from "../utils/dom";
import { Theme } from "./core/Theme";
import { DevTools } from "./dev/DevTools";
import { CommandlineHotkey } from "./hotkeys/CommandlineHotkey";
import { Footer } from "./layout/footer/Footer";
import { Header } from "./layout/header/Header";
import { Overlays } from "./layout/overlays/Overlays";
import { Modals } from "./modals/Modals";
import { AboutPage } from "./pages/AboutPage";
import { AccountPage } from "./pages/account/AccountPage";
import { MyProfile } from "./pages/account/MyProfile";
import { LeaderboardPage } from "./pages/leaderboard/LeaderboardPage";
import { LoginPage } from "./pages/login/LoginPage";
import { ProfilePage } from "./pages/profile/ProfilePage";
import { ProfileSearchPage } from "./pages/profile/ProfileSearchPage";
import { RacePage } from "./pages/race/RacePage";
import { RaceProgressBars } from "./pages/race/RaceProgressBars";
import { ResultProgressPanel } from "./pages/test/ResultProgressPanel";
import { TestConfig } from "./pages/test/TestConfig";
import { TypingFeedbackPanel } from "./pages/test/TypingFeedbackPanel";
import { Popups } from "./popups/Popups";

const fullComponents: Record<string, () => JSXElement> = {
  footer: () => <Footer />,
  aboutpage: () => <AboutPage />,
  accountpage: () => <AccountPage />,
  loginpage: () => <LoginPage />,
  leaderboardpage: () => <LeaderboardPage />,
  racepage: () => <RacePage />,
  raceprogressbars: () => <RaceProgressBars testOverlay />,
  profilepage: () => <ProfilePage />,
  profilesearchpage: () => <ProfileSearchPage />,
  myprofile: () => <MyProfile />,
  modals: () => <Modals />,
  popups: () => <Popups />,
  overlays: () => <Overlays />,
  theme: () => <Theme />,
  header: () => <Header />,
  devtools: () => <DevTools />,
  testconfig: () => <TestConfig />,
  typingfeedbackpanel: () => <TypingFeedbackPanel variant="result" />,
  resultprogresspanel: () => <ResultProgressPanel />,
  commandlinehotkey: () => <CommandlineHotkey />,
};

const liteComponents: Record<string, () => JSXElement> = {
  modals: () => <Modals />,
  popups: () => <Popups />,
  overlays: () => <Overlays />,
  theme: () => <Theme />,
  header: () => <Header />,
  testconfig: () => <TestConfig />,
};

function mountToMountpoint(name: string, component: () => JSXElement): void {
  for (const mountPoint of qsa(name)) {
    render(
      () => (
        <QueryClientProvider client={queryClient}>
          {component()}
        </QueryClientProvider>
      ),
      mountPoint.native,
    );
  }
}

export function mountComponents(): void {
  const components = envConfig.liteMode ? liteComponents : fullComponents;
  for (const [query, component] of Object.entries(components)) {
    mountToMountpoint(`mount[data-component=${query}]`, component);
  }
}
