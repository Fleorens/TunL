/** Flèches (sens de la liste), Home, End : quelle direction, et où atterrir. */

export type ListMove = "next" | "previous" | "first" | "last";

/** Flèches dans le sens de la liste (`vertical` : ↓ ↑, `horizontal` : → ←), Home et End ; sinon `null`. */
export function listMove(key: string, orientation: "vertical" | "horizontal"): ListMove | null {
  switch (orientation) {
    case "vertical":
      switch (key) {
        case "ArrowDown":
          return "next";
        case "ArrowUp":
          return "previous";
        case "Home":
          return "first";
        case "End":
          return "last";
      }
      break;
    case "horizontal":
      switch (key) {
        case "ArrowRight":
          return "next";
        case "ArrowLeft":
          return "previous";
        case "Home":
          return "first";
        case "End":
          return "last";
      }
      break;
  }
  return null;
}

/** L'index d'arrivée. `wrap` : après le dernier vient le premier ; sinon les bouts tiennent.
 *  Rien de focalisé (`current` −1) : next → le premier, previous → le dernier. Liste vide → −1. */
export function moveIndex(move: ListMove, current: number, count: number, wrap: boolean): number {
  if (count === 0) return -1;
  if (current === -1) return move === "previous" ? count - 1 : 0;

  let index: number;
  switch (move) {
    case "next":
      index = current + 1;
      break;
    case "previous":
      index = current - 1;
      break;
    case "first":
      index = 0;
      break;
    case "last":
      index = count - 1;
      break;
  }

  if (wrap) return ((index % count) + count) % count;
  if (index < 0) return 0;
  if (index > count - 1) return count - 1;
  return index;
}
