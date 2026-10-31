// A folder path from the server reaches a new shell only through `shellQuote`, so a name like
// `x'; rm -rf ~; '` stays a name, never a command. A path with a control character never reaches it: the
// terminal's line editor acts on those (Ctrl-U erases the line, Esc…) before the shell reads any quote.

/**
 * `value` between single quotes, a quote inside written `'\''`: safe in sh, bash, zsh and fish. A backslash is
 * written `'"\\"'`, since fish reads `\'` and `\\` as escapes even between single quotes.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/['\\]/g, (ch) => (ch === "'" ? "'\\''" : `'"\\\\"'`))}'`;
}

/** Whether `value` holds a control character (C0, DEL or C1): such a path is never typed into a shell. */
export function hasControlChar(value: string): boolean {
  return [...value].some((ch) => {
    const code = ch.charCodeAt(0);
    return code < 0x20 || (code >= 0x7f && code <= 0x9f);
  });
}

/** The line typed into a new shell to go to `dir`: `cd '<dir>'` then Enter (`\r`). */
export function cdCommand(dir: string): string {
  return `cd ${shellQuote(dir)}\r`;
}
