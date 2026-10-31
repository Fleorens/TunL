// A folder path from the server reaches a new shell only through `shellQuote`, so a name like
// `x'; rm -rf ~; '` stays a name, never a command.

/** `value` between single quotes, a quote inside written `'\''`: safe in sh, bash, zsh and fish. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** The line typed into a new shell to go to `dir`: `cd '<dir>'` then Enter (`\r`). */
export function cdCommand(dir: string): string {
  return `cd ${shellQuote(dir)}\r`;
}
