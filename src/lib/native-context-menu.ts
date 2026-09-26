/** Blocks WebKit's native context menu (Reload, Inspect…) everywhere except in text fields. */
export function disableNativeContextMenu(): void {
  window.addEventListener("contextmenu", (event) => {
    const target = event.target;
    const isEditable =
      target instanceof HTMLElement &&
      (target.isContentEditable || target.closest("input, textarea") !== null);
    if (!isEditable) {
      event.preventDefault();
    }
  });
}
