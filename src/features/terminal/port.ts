/**
 * A terminal port: bytes arrive, keys leave, and a size is forwarded only when it changes.
 *
 * Output that arrives before anyone subscribes is kept and replayed in order on the next
 * subscription; after the last listener leaves, output is kept again. Only one listener
 * receives at a time, and a new subscription replaces the previous one.
 */

export interface TerminalPort {
  /**
   * Begin receiving output. What arrived while nobody listened is replayed first, then output
   * goes live. Returns the unsubscribe: after it, output is kept again for the next listener.
   */
  subscribe(listener: (bytes: Uint8Array) => void): () => void;
  /** Send a key press (or any input) straight to the sender. */
  write(data: string): void;
  /** Forward a new size; unchanged sizes are ignored. */
  resize(cols: number, rows: number): void;
  /**
   * Ack that `bytes` of output were displayed, so the shell's flow control can resume (T50). A chunk
   * dropped here (nobody was listening) is acked at once, exactly like a displayed one would be.
   */
  ack(bytes: number): void;
}

export interface PortSender {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /** Ack `bytes` of output the terminal finished with. Optional: T20's tests build a sender without it. */
  ack?(bytes: number): void;
}

/** The most output kept before a subscription, at most, before the oldest chunks are dropped. */
export const PORT_BUFFER_LIMIT = 1024 * 1024;

export function createTerminalPort(
  sender: PortSender,
  limit: number = PORT_BUFFER_LIMIT,
): { port: TerminalPort; push(bytes: Uint8Array): void } {
  // Chunks that arrived while nobody listened, replayed oldest first.
  let buffer: Uint8Array[] = [];
  // The listener currently receiving live output, or null when output must be kept.
  let listener: ((bytes: Uint8Array) => void) | null = null;
  // The last size forwarded, so an unchanged size is dropped.
  let lastSize: { cols: number; rows: number } | null = null;

  const keep = (bytes: Uint8Array): void => {
    buffer.push(bytes);
    // Beyond the limit, drop the oldest chunks so a huge output cannot fill memory.
    let total = 0;
    for (let i = buffer.length - 1; i >= 0; i--) {
      total += buffer[i].length;
      if (total > limit) {
        // The dropped chunks were never shown: ack them at once, so the shell's flow control frees
        // exactly like a displayed chunk would (T50).
        let dropped = 0;
        for (let j = 0; j <= i; j++) {
          dropped += buffer[j].length;
        }
        sender.ack?.(dropped);
        buffer = buffer.slice(i + 1);
        break;
      }
    }
  };

  const port: TerminalPort = {
    subscribe(next) {
      // A new listener replaces the previous one.
      listener = next;
      // Replay what arrived while nobody listened, then go live.
      for (const chunk of buffer) {
        next(chunk);
      }
      buffer = [];
      return () => {
        // Only unsubscribe if this listener is still the active one.
        if (listener === next) {
          listener = null;
        }
      };
    },
    write(data) {
      sender.write(data);
    },
    resize(cols, rows) {
      if (lastSize && lastSize.cols === cols && lastSize.rows === rows) {
        return;
      }
      lastSize = { cols, rows };
      sender.resize(cols, rows);
    },
    ack(bytes) {
      sender.ack?.(bytes);
    },
  };

  return {
    port,
    push(bytes) {
      if (listener) {
        listener(bytes);
      } else {
        keep(bytes);
      }
    },
  };
}
