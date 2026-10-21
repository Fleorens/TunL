// The Settings tab — Terminal: theme, font (validated on enter/blur), size, line height, cursor, scrollback,
// copy on select. Each change is saved at once, building a new settings object.
import { type ChangeEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import {
  SettingGroup,
  SettingRow,
  SettingSelect,
  SettingSwitch,
} from "@/features/settings/SettingRow";
import { saveSettings } from "@/features/settings/save-settings";
import {
  cleanFontFamily,
  FONT_FAMILY_MAX,
  FONT_SIZES,
  LINE_HEIGHTS,
  SCROLLBACKS,
  withCurrent,
} from "@/features/settings/settings-options";
import { useSettings } from "@/features/settings/store";

const THEMES = ["auto", "tunlNight", "tunlDay"] as const;
const CURSTYLES = ["bar", "block", "underline"] as const;

/**
 * The font name, edited in place and saved on enter or blur; an invalid draft is shown, not saved. The
 * draft lives here so that `key={fontFamily}` on the row restarts it from the saved value.
 */
function FontFamilyRow({ fontFamily }: { fontFamily: string | undefined }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string>(fontFamily ?? "");
  const cleaned = cleanFontFamily(draft);
  const commit = () => {
    if (cleaned === null) return;
    if (cleaned === fontFamily) {
      setDraft(cleaned);
      return;
    }
    // Saved: the new key remounts the row. Refused: back to the saved value.
    void saveSettings((s) => ({ ...s, terminal: { ...s.terminal, fontFamily: cleaned } })).then(
      (saved) => {
        if (!saved) setDraft(fontFamily ?? "");
      },
    );
  };

  return (
    <SettingRow
      id="fontFamily"
      label={t("settings.terminal.fontFamily")}
      description={
        cleaned === null
          ? t("settings.terminal.fontFamilyInvalid", { max: FONT_FAMILY_MAX })
          : t("settings.terminal.fontFamilyHelp")
      }
    >
      <Input
        type="text"
        id="fontFamily"
        className="w-48 font-mono"
        value={draft}
        aria-invalid={cleaned === null}
        placeholder={fontFamily}
        onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
        onBlur={commit}
      />
    </SettingRow>
  );
}

export function TerminalSection() {
  const { t } = useTranslation();
  const terminal = useSettings((s) => s.settings?.terminal);
  const theme = terminal?.theme;
  const fontFamily = terminal?.fontFamily;
  const fontSize = terminal?.fontSize ?? 13;
  const lineHeight = terminal?.lineHeight ?? 1.25;
  const cursorStyle = terminal?.cursorStyle;
  const cursorBlink = terminal?.cursorBlink;
  const scrollback = terminal?.scrollback ?? 10_000;
  const copyOnSelect = terminal?.copyOnSelect;

  const themeOptions = THEMES.map((value) => ({
    value,
    label: t(`settings.terminal.themes.${value}`),
  }));
  const cursorOptions = CURSTYLES.map((value) => ({
    value,
    label: t(`settings.terminal.cursors.${value}`),
  }));
  const fontSizeOptions = withCurrent(FONT_SIZES, fontSize).map((size) => ({
    value: String(size),
    label: t("settings.terminal.pixels", { count: size }),
  }));
  const lineHeightOptions = LINE_HEIGHTS.map((value) => ({
    value: String(value),
    label: value.toFixed(2),
  }));
  const scrollbackOptions = SCROLLBACKS.map((size) => ({
    value: String(size),
    label: t("settings.terminal.lines", { count: size }),
  }));

  return (
    <SettingGroup>
      <SettingSelect
        label={t("settings.terminal.theme")}
        value={theme ?? "auto"}
        options={themeOptions}
        onChange={(next) =>
          saveSettings((s) => ({ ...s, terminal: { ...s.terminal, theme: next } }))
        }
      />

      <FontFamilyRow key={fontFamily} fontFamily={fontFamily} />

      <SettingSelect
        label={t("settings.terminal.fontSize")}
        value={String(fontSize)}
        options={fontSizeOptions}
        onChange={(next) =>
          saveSettings((s) => ({ ...s, terminal: { ...s.terminal, fontSize: Number(next) } }))
        }
      />
      <SettingSelect
        label={t("settings.terminal.lineHeight")}
        value={String(lineHeight)}
        options={lineHeightOptions}
        onChange={(next) =>
          saveSettings((s) => ({ ...s, terminal: { ...s.terminal, lineHeight: Number(next) } }))
        }
      />
      <SettingSelect
        label={t("settings.terminal.cursorStyle")}
        value={cursorStyle ?? "bar"}
        options={cursorOptions}
        onChange={(next) =>
          saveSettings((s) => ({ ...s, terminal: { ...s.terminal, cursorStyle: next } }))
        }
      />
      <SettingSwitch
        label={t("settings.terminal.cursorBlink")}
        checked={cursorBlink ?? false}
        onChange={(next) =>
          saveSettings((s) => ({ ...s, terminal: { ...s.terminal, cursorBlink: next } }))
        }
      />
      <SettingSelect
        label={t("settings.terminal.scrollback")}
        value={String(scrollback)}
        options={scrollbackOptions}
        onChange={(next) =>
          saveSettings((s) => ({ ...s, terminal: { ...s.terminal, scrollback: Number(next) } }))
        }
      />
      <SettingSwitch
        label={t("settings.terminal.copyOnSelect")}
        checked={copyOnSelect ?? false}
        onChange={(next) =>
          saveSettings((s) => ({ ...s, terminal: { ...s.terminal, copyOnSelect: next } }))
        }
      />
    </SettingGroup>
  );
}
