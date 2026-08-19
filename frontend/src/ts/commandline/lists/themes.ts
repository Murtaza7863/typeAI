import { Config } from "../../config/store";
import { setConfig } from "../../config/setters";
import { capitalizeFirstLetterOfEachWord } from "../../utils/strings";
import * as ThemeController from "../../controllers/theme-controller";
import { Command, CommandsSubgroup } from "../types";
import {
  ThemesList,
  ThemeWithName,
  getThemeDisplayName,
  DEFAULT_THEME_NAME,
} from "../../constants/themes";
import { not } from "@typeai/util/predicates";
import { configEvent } from "../../events/config";
import * as getErrorMessage from "../../utils/error";

const isFavorite = (theme: ThemeWithName): boolean =>
  Config.favThemes.includes(theme.name);

/**
 * creates a theme command object for the given theme
 * @param theme the theme to create a command for
 * @returns a command object for the theme
 */
const createThemeCommand = (theme: ThemeWithName): Command => {
  return {
    id: `changeTheme${capitalizeFirstLetterOfEachWord(theme.name)}`,
    display: getThemeDisplayName(theme.name),
    alias: theme.name === DEFAULT_THEME_NAME ? "typeai type ai" : undefined,
    configValue: theme.name,
    // customStyle: `color:${theme.main};background:${theme.bg};`,
    customData: {
      main: theme.main,
      bg: theme.bg,
      sub: theme.sub,
      text: theme.text,
      isFavorite: isFavorite(theme),
    },
    hover: (): void => {
      // previewTheme(theme.name);
      ThemeController.preview(theme.name);
    },
    exec: (): void => {
      setConfig("theme", theme.name);
    },
  };
};

/**
 * sorts themes with favorites first, then non-favorites
 * @param themes the themes to sort
 * @returns sorted array of themes
 */
const sortThemesByFavorite = (themes: ThemeWithName[]): ThemeWithName[] => {
  const isDefault = (theme: ThemeWithName): boolean =>
    theme.name === DEFAULT_THEME_NAME;
  const rest = themes.filter(not(isDefault));
  return [
    ...themes.filter(isDefault),
    ...rest.filter(isFavorite),
    ...rest.filter(not(isFavorite)),
  ];
};

const subgroup: CommandsSubgroup = {
  title: "Theme...",
  configKey: "theme",
  list: sortThemesByFavorite(ThemesList).map((theme) =>
    createThemeCommand(theme),
  ),
};

const commands: Command[] = [
  {
    id: "changeTheme",
    display: "Theme...",
    icon: "fa-palette",
    subgroup,
  },
];

export function update(themes: ThemeWithName[]): void {
  // clear the current list
  subgroup.list = [];

  // rebuild with favorites first, then non-favorites
  subgroup.list = sortThemesByFavorite(themes).map((theme) =>
    createThemeCommand(theme),
  );
}

// subscribe to theme-related config events to update the theme command list
configEvent.subscribe(({ key }) => {
  if (key === "favThemes") {
    // update themes list when favorites change
    try {
      update(ThemesList);
    } catch (e: unknown) {
      console.error(
        getErrorMessage.createErrorMessage(
          e,
          "Failed to update themes commands",
        ),
      );
    }
  }
});

export default commands;
