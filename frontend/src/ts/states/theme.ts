import { createSignal } from "solid-js";
import { ColorName, Theme } from "../constants/themes";
import { ThemeName } from "@typeai/schemas/configs";

export type ThemeIdentifier = ThemeName | "custom";
const defaultTheme: Theme & { name: ThemeIdentifier } = {
  name: "serika_dark",
  bg: "#1a2b2b",
  main: "#2dd4bf",
  caret: "#2dd4bf",
  sub: "#4d7373",
  subAlt: "#243838",
  text: "#e0f2f1",
  error: "#ca4754",
  errorExtra: "#7e2a33",
  colorfulError: "#ca4754",
  colorfulErrorExtra: "#7e2a33",
};

export const [getTheme, setTheme] = createSignal(defaultTheme);

export function updateThemeColor(key: ColorName, color: string): void {
  setTheme((prev) => ({
    ...prev,
    [key]: color,
  }));
}
