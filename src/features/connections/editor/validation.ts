/**
 * Field validation, reproduced from the Rust side (docs/05-modele-donnees.md §6).
 *
 * The schema uses these helpers so the UI rejects what the backend would reject. Each error is a
 * code from `VALIDATION_CODES`; `FieldError` renders it with `t("validation.<code>")`.
 */

/** A tag: lowercase letters, digits, dots, dashes and underscores, 1–24 characters. */
export const TAG_PATTERN = /^[a-z0-9._-]{1,24}$/;

/** The codes every form error message must be, so it can be translated by `validation.<code>`. */
export const VALIDATION_CODES = [
  "required",
  "tooLong",
  "controlChars",
  "invalidHost",
  "invalidPort",
  "invalidTag",
  "tooManyTags",
  "invalidPath",
] as const;

export type ValidationCode = (typeof VALIDATION_CODES)[number];

/** True when `code` is one of the known form validation codes. */
export function isValidationCode(code: string): code is ValidationCode {
  return (VALIDATION_CODES as readonly string[]).includes(code);
}

/**
 * A control character is any code point below U+0020, or between U+007F and U+009F.
 * The backend refuses them everywhere (docs/05-modele-donnees.md §6).
 */
export function hasControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code !== undefined && (code <= 0x1f || (code >= 0x7f && code <= 0x9f))) {
      return true;
    }
  }
  return false;
}

function isIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const number = Number(part);
    return number >= 0 && number <= 255;
  });
}

/** IPv6 without brackets: hex digits and colons only, with at least one colon. */
function isIpv6(value: string): boolean {
  return /:/.test(value) && /^[0-9a-fA-F:]+$/.test(value);
}

function isHostname(value: string): boolean {
  return value.split(".").every((label) => {
    if (label.length < 1 || label.length > 63) return false;
    if (label.startsWith("-") || label.endsWith("-")) return false;
    return /^[A-Za-z0-9_-]+$/.test(label);
  });
}

/**
 * A host after trim: 1–253 characters, no control character, and either an IPv4 address,
 * an IPv6 address without brackets, or a host name. Anything else is invalid.
 */
export function isValidHost(host: string): boolean {
  const value = host.trim();
  if (value.length < 1 || value.length > 253) return false;
  if (hasControlChars(value)) return false;
  return isIpv4(value) || isIpv6(value) || isHostname(value);
}

/** A key path after trim: non-empty, no control character, absolute or starting with `~/`. */
export function isValidPath(path: string): boolean {
  const value = path.trim();
  if (value.length < 1) return false;
  if (hasControlChars(value)) return false;
  return value.startsWith("/") || value.startsWith("~/");
}
