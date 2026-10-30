// T52: the backend's import notes (technical English) are shown translated; anything unknown is shown as it came.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { i18n } from "@/i18n";
import { importErrorText, importNoteText } from "./import-notes";

beforeAll(async () => {
  await i18n.changeLanguage("fr");
});

afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("the notes of an imported host, in French", () => {
  test.each([
    ["ProxyCommand is ignored", "ProxyCommand est ignoré"],
    ["only the last ProxyJump hop is used", "Seul le dernier saut de ProxyJump est repris"],
    ["Match blocks are ignored", "Les blocs Match sont ignorés"],
    ["Include nested too deeply: ~/.ssh/conf.d/a", "Include trop imbriqué : ~/.ssh/conf.d/a"],
    [
      "HostName tokens other than %h are not supported",
      "Seul le jeton %h est pris en charge dans HostName",
    ],
    ["invalid Port: 99999", "Port invalide : 99999"],
  ])("%s", (raw, expected) => {
    expect(importNoteText(raw)).toBe(expected);
  });

  test("an unknown note is shown as it came", () => {
    expect(importNoteText("something new")).toBe("something new");
  });
});

describe("the refusal of an imported host, in French", () => {
  test("names the wrong field", () => {
    expect(importErrorText("host: must be a valid IPv4, IPv6 address or host name")).toBe(
      "Hôte invalide",
    );
    expect(importErrorText("settings.auth.path: is too long")).toBe("Fichier de clé invalide");
  });

  test("an unknown field or shape is shown as it came", () => {
    expect(importErrorText("color: is unknown")).toBe("color: is unknown");
    expect(importErrorText("broken")).toBe("broken");
  });
});
