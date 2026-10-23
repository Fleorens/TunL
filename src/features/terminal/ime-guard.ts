/**
 * IBus / WebKitGTK orphan-composition guard.
 *
 * On those backends, a key typed through the IME arrives as a `keydown` with code 229 (IME
 * composition). xterm sends that keystroke to the terminal right away, on the keydown. A
 * `compositionend` then follows — even when there was never a `compositionstart` (an orphan).
 * xterm's `_finalizeComposition` re-reads `textarea.value` on that event and re-sends it, so a
 * single typed character is written twice ("ls" becomes "lss").
 *
 * The guard listens on the host (an ancestor of xterm's textarea) in the capture phase, so it sees
 * the event before the textarea does. An orphan `compositionend` is stopped there and xterm never
 * sees it. A real composition (`compositionstart` first) is let through untouched.
 */
export function guardOrphanCompositionEnd(host: HTMLElement): () => void {
  let composing = false;

  const onStart = (): void => {
    composing = true;
  };

  const onEnd = (event: Event): void => {
    if (composing) {
      // A real composition is closing: let xterm finalize it as usual.
      composing = false;
      return;
    }
    // Orphan compositionend (never preceded by compositionstart): xterm already sent the keystroke
    // on the keydown 229, so this second dispatch would duplicate it. Stop it here, on the capture
    // phase, before it reaches xterm's textarea.
    event.stopPropagation();
  };

  host.addEventListener("compositionstart", onStart, { capture: true });
  host.addEventListener("compositionend", onEnd, { capture: true });

  return (): void => {
    host.removeEventListener("compositionstart", onStart, { capture: true });
    host.removeEventListener("compositionend", onEnd, { capture: true });
  };
}
