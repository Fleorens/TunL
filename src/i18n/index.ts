import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

export const SUPPORTED_LANGUAGES = ["en", "fr"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export type LanguagePreference = "system" | SupportedLanguage;

export function detectSystemLanguage(languages: readonly string[]): SupportedLanguage {
  for (const tag of languages) {
    const base = tag.toLowerCase().split("-")[0];
    if (base === "fr" || base === "en") {
      return base;
    }
  }
  return "en";
}

export function resolveLanguage(
  preference: LanguagePreference,
  systemLanguages: readonly string[],
): SupportedLanguage {
  return preference === "system" ? detectSystemLanguage(systemLanguages) : preference;
}

export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, fr: { translation: fr } },
  lng: resolveLanguage("system", navigator.languages),
  fallbackLng: "en",
  interpolation: { escapeValue: false }, // React already escapes rendered text
  initAsync: false,
});

document.documentElement.lang = i18n.language;

export async function setLanguage(preference: LanguagePreference): Promise<void> {
  const language = resolveLanguage(preference, navigator.languages);
  await i18n.changeLanguage(language);
  document.documentElement.lang = language;
}
