// The selection of the SFTP table, as paths: a click, Ctrl, Shift and Ctrl+A, and what a refresh keeps.
// Pure: every function returns a new value, never mutates its input (docs/01 §6.1).

/** The selected lines (paths), the anchor of a range (Shift) and the keyboard cursor's line. */
export interface Selection {
  readonly paths: readonly string[];
  readonly anchor: string | null;
  readonly focus: string | null;
}

/** The empty selection: nothing, no anchor, no cursor. */
export const EMPTY_SELECTION: Selection = { paths: [], anchor: null, focus: null };

/** A single click: this one line; anchor and cursor on it. */
export function selectOne(path: string): Selection {
  return { paths: [path], anchor: path, focus: path };
}

/** Ctrl+click: add or remove `path` (added at the end); anchor and cursor on it. */
export function toggle(selection: Selection, path: string): Selection {
  const has = selection.paths.includes(path);
  const paths = has ? selection.paths.filter((p) => p !== path) : [...selection.paths, path];
  return { paths, anchor: path, focus: path };
}

/**
 * Shift+click: the range from the anchor to `path`, in the shown `order`, replaces the selection; the anchor does not
 * move, the cursor goes on `path`. Without an anchor, or an anchor absent from `order`: `selectOne(path)`.
 */
export function extendTo(selection: Selection, order: readonly string[], path: string): Selection {
  const anchor = selection.anchor;
  const a = anchor === null ? -1 : order.indexOf(anchor);
  const b = order.indexOf(path);
  if (a < 0 || b < 0) return selectOne(path);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return { paths: order.slice(lo, hi + 1), anchor, focus: path };
}

/** Ctrl+A: every shown line, in order; anchor and cursor on the first (or `null`). */
export function selectAll(order: readonly string[]): Selection {
  const first = order.length > 0 ? order[0] : null;
  return { paths: order, anchor: first, focus: first };
}

/**
 * After a refresh or hiding hidden files: drop what is no longer shown. Returns the same object when nothing changes.
 * An anchor or cursor that is gone becomes `null`.
 */
export function keepVisible(selection: Selection, order: readonly string[]): Selection {
  const paths = selection.paths.filter((p) => order.includes(p));
  const anchor =
    selection.anchor !== null && order.includes(selection.anchor) ? selection.anchor : null;
  const focus =
    selection.focus !== null && order.includes(selection.focus) ? selection.focus : null;
  const unchanged =
    paths.length === selection.paths.length &&
    paths.every((p, i) => p === selection.paths[i]) &&
    anchor === selection.anchor &&
    focus === selection.focus;
  if (unchanged) return selection;
  return { paths, anchor, focus };
}

/** A click on a line: Ctrl (or Meta) → `toggle`, Shift → `extendTo`, otherwise `selectOne`. */
export function clickRow(
  selection: Selection,
  order: readonly string[],
  path: string,
  modifiers: { ctrl: boolean; shift: boolean },
): Selection {
  if (modifiers.ctrl) return toggle(selection, path);
  if (modifiers.shift) return extendTo(selection, order, path);
  return selectOne(path);
}
