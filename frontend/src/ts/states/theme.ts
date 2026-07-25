import { createSignal } from "solid-js";
import { ColorName, Theme } from "../constants/themes";
import { ThemeName } from "@typeai/schemas/configs";

export type ThemeIdentifier = ThemeName | "custom";
const defaultTheme: Theme & { name: ThemeIdentifier } = {
  name: "typeai",
  bg: "#08141c",
  main: "#3ee0b0",
  caret: "#7ef0c8",
  sub: "#3e6570",
  subAlt: "#0f1f2a",
  text: "#e6faf4",
  error: "#ff6b81",
  errorExtra: "#a33d4d",
  colorfulError: "#ff6b81",
  colorfulErrorExtra: "#a33d4d",
};

export const [getTheme, setTheme] = createSignal(defaultTheme);

export function updateThemeColor(key: ColorName, color: string): void {
  setTheme((prev) => ({
    ...prev,
    [key]: color,
  }));
}
