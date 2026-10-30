// The backend's import messages are fixed technical English (docs/06 S7): ignored options, unsupported
// tokens, and `field: reason` refusals. The UI translates a closed list of these shapes (docs, T52);
// anything else is shown as it came. Every translation reads `i18n.t` with a key built from a closed
// list, never from backend text.

import { i18n } from "@/i18n";

// A single-word option (`ProxyCommand`, `LocalForward`…), then ` is ignored`.
const OPTION_IGNORED = /^(\S+) is ignored$/;
// `Include nested too deeply: <path>` and `invalid Port: <value>` carry a trailing value.
const INCLUDE_TOO_DEEP = /^Include nested too deeply: (.+)$/;
const INVALID_PORT = /^invalid Port: (.+)$/;

// The `field: reason` refusals the UI can name. Unknown fields fall through to the raw text.
const FIELD_KEYS = ["name", "host", "port", "username", "settings.auth.path"] as const;

/** True when `field` is one of the refusals the UI can translate by name. */
function isFieldKey(field: string): field is (typeof FIELD_KEYS)[number] {
  return (FIELD_KEYS as readonly string[]).includes(field);
}

/**
 * Translate a host- or file-level note (`ProxyCommand is ignored`, `Match blocks are ignored`, …).
 * An unknown text is returned untouched.
 */
export function importNoteText(raw: string): string {
  const option = raw.match(OPTION_IGNORED);
  if (option) return i18n.t("import.notes.optionIgnored", { option: option[1] });

  if (raw === "only the last ProxyJump hop is used") return i18n.t("import.notes.lastHopOnly");
  if (raw === "Match blocks are ignored") return i18n.t("import.notes.matchIgnored");

  const path = raw.match(INCLUDE_TOO_DEEP);
  if (path) return i18n.t("import.notes.includeTooDeep", { path: path[1] });

  if (raw === "HostName tokens other than %h are not supported")
    return i18n.t("import.notes.hostTokens");

  const value = raw.match(INVALID_PORT);
  if (value) return i18n.t("import.notes.invalidPort", { value: value[1] });

  return raw;
}

/**
 * Translate a `field: reason` refusal into `Invalid <field>` (or `<field> invalide`), naming the
 * field with `import.fields.<field>`. An unknown field, or text without `: `, is returned untouched.
 */
export function importErrorText(raw: string): string {
  const separator = raw.indexOf(": ");
  if (separator === -1) return raw;
  const field = raw.slice(0, separator);
  if (!isFieldKey(field)) return raw;
  return i18n.t("import.notes.invalidField", { field: i18n.t(`import.fields.${field}`) });
}
