import { createTerminalPort, type PortSender, type TerminalPort } from "@/features/terminal/port";

/**
 * A local echo port for the design gallery: whatever the terminal types is echoed back under a
 * minimal `$ ` prompt, so the terminal can be exercised in the browser without a session.
 *
 * The sender is wired to the port's `push`: input that arrives goes through the echo logic, which
 * feeds the echoed bytes back into the port. Output that arrives before anyone subscribes is kept
 * and replayed on the next subscription.
 */
export function createEchoPort(): TerminalPort {
  const encoder = new TextEncoder();
  // The current command line, accumulated across keystrokes (declared once, not per write).
  let line = "";
  // Assigned once the port exists; the sender reads it lazily on each keystroke.
  let push: (bytes: Uint8Array) => void = () => {};

  const sender: PortSender = {
    write(data: string): void {
      const enc = (text: string): Uint8Array => encoder.encode(text);
      for (const ch of data) {
        if (ch === "\r") {
          // Carriage return: finish the line, show what was typed, wait again.
          push(enc(`\r\nyou typed: ${line}\r\n$ `));
          line = "";
        } else if (ch === "\u0003") {
          // Ctrl+C: cancel the line.
          push(enc("^C\r\n$ "));
          line = "";
        } else if (ch === "\u007f") {
          // Backspace: erase the last character.
          if (line.length > 0) {
            line = line.slice(0, -1);
            push(enc("\b \b"));
          }
        } else if (ch >= " " && ch <= "~") {
          // Printable character: remember it and echo it.
          line += ch;
          push(enc(ch));
        }
        // Any other control character is ignored.
      }
    },
    resize(): void {
      // Nothing to do for a local echo.
    },
  };

  const { port, push: pushBytes } = createTerminalPort(sender);
  push = pushBytes;
  // The first thing the terminal sees: a banner and an empty prompt.
  push(encoder.encode("TunL terminal demo\r\n$ "));
  return port;
}
