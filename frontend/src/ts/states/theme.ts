import { createSignal } from "solid-js";
import { ColorName, Theme } from "../constants/themes";
import { ThemeName } from "@typeai/schemas/configs";

export type ThemeIdentifier = ThemeName | "custom";
const defaultTheme: Theme & { name: ThemeIdentifier } = {
  name: "serika_dark",
  bg: "#121a1f",
  main: "#5eead4",
  caret: "#5eead4",
  sub: "#5f7d82",
  subAlt: "#1a252c",
  text: "#d7ebe8",
  error: "#e06b75",
  errorExtra: "#8f3a44",
  colorfulError: "#e06b75",
  colorfulErrorExtra: "#8f3a44",
};

export const [getTheme, setTheme] = createSignal(defaultTheme);

export function updateThemeColor(key: ColorName, color: string): void {
  setTheme((prev) => ({
    ...prev,
    [key]: color,
  }));
}
