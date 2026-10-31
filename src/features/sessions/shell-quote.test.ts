// T58: a folder path reaches a new shell only quoted, whatever it contains.
import { describe, expect, test } from "vitest";
import { cdCommand, shellQuote } from "./shell-quote";

describe("shell quoting", () => {
  test("a plain path is put between single quotes", () => {
    expect(shellQuote("/var/www/html")).toBe("'/var/www/html'");
    expect(shellQuote("/srv/my files")).toBe("'/srv/my files'");
  });

  test("a single quote is closed, escaped, then reopened", () => {
    expect(shellQuote("/home/o'neil")).toBe("'/home/o'\\''neil'");
    expect(shellQuote("x'; rm -rf ~; '")).toBe("'x'\\''; rm -rf ~; '\\'''");
  });

  test("$, backquotes and newlines stay literal inside the quotes", () => {
    expect(shellQuote("/tmp/$HOME/`id`")).toBe("'/tmp/$HOME/`id`'");
    expect(shellQuote("/tmp/a\nb")).toBe("'/tmp/a\nb'");
  });

  test("cd goes to the folder, then Enter", () => {
    expect(cdCommand("/var/www")).toBe("cd '/var/www'\r");
  });
});
