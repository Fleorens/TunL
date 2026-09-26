import type { AccentColor } from "@/bindings/AccentColor";

export type { AccentColor };

/** The only place where Tailwind's built-in palette is allowed (docs/05-modele-donnees.md §2). */
export const ACCENT_DOT_CLASSES: Record<AccentColor, string> = {
  slate: "bg-slate-500 dark:bg-slate-400",
  red: "bg-red-500 dark:bg-red-400",
  orange: "bg-orange-500 dark:bg-orange-400",
  amber: "bg-amber-500 dark:bg-amber-400",
  green: "bg-green-500 dark:bg-green-400",
  teal: "bg-teal-500 dark:bg-teal-400",
  cyan: "bg-cyan-500 dark:bg-cyan-400",
  blue: "bg-blue-500 dark:bg-blue-400",
  violet: "bg-violet-500 dark:bg-violet-400",
  pink: "bg-pink-500 dark:bg-pink-400",
};
