import * as TestStats from "../test/test-stats";
import * as TestLogic from "../test/test-logic";
import * as Funbox from "../test/funbox/funbox";
import Page from "./page";
import * as ModesNotice from "../elements/modes-notice";
import * as Keymap from "../elements/keymap";
import { blurInputElement } from "../input/input-element";
import { permitNextRaceRestart, restoreAfterRace } from "../race/controller";
import { getRaceParty, isRaceActive } from "../states/race";
import { qsr } from "../utils/dom";

export const page = new Page({
  id: "test",
  element: qsr(".page.pageTest"),
  path: "/",
  beforeHide: async (): Promise<void> => {
    blurInputElement();
  },
  afterHide: async (): Promise<void> => {
    if (getRaceParty()?.status === "finished") {
      restoreAfterRace();
    }
    if (!isRaceActive()) {
      TestLogic.restart({
        noAnim: true,
      });
      void Funbox.clear();
    }
    void ModesNotice.update();
  },
  beforeShow: async (): Promise<void> => {
    const status = getRaceParty()?.status;
    if (isRaceActive() || status === "racing" || status === "countdown") {
      permitNextRaceRestart();
    }
    TestStats.resetIncomplete();
    TestLogic.restart({
      noAnim: true,
    });
    void Keymap.refresh();
  },
});
