/** Pure selection logic for the `~/.ssh/config` import dialog. No React, no I/O. */

import type { ImportCandidate } from "@/bindings/ImportCandidate";
import type { ImportJump } from "@/bindings/ImportJump";

/** A candidate with an `error` can never be imported. */
export function isSelectable(candidate: ImportCandidate): boolean {
  return candidate.error == null;
}

/** Candidates that would be selected at first: selectable and not already present, in file order. */
export function initialSelection(candidates: readonly ImportCandidate[]): string[] {
  const selected: string[] = [];
  for (const candidate of candidates) {
    if (isSelectable(candidate) && candidate.duplicateOf == null) {
      selected.push(candidate.alias);
    }
  }
  return selected;
}

/** Every selectable alias, in file order. */
function selectableAliases(candidates: readonly ImportCandidate[]): string[] {
  const aliases: string[] = [];
  for (const candidate of candidates) {
    if (isSelectable(candidate)) {
      aliases.push(candidate.alias);
    }
  }
  return aliases;
}

/** Adds or removes `alias`; returns a new array (never mutates `selection`). */
export function toggleAlias(selection: readonly string[], alias: string): string[] {
  return selection.includes(alias)
    ? selection.filter((item) => item !== alias)
    : [...selection, alias];
}

/** Every selectable alias when at least one is unselected, otherwise none. */
export function toggleAll(
  candidates: readonly ImportCandidate[],
  selection: readonly string[],
): string[] {
  const aliases = selectableAliases(candidates);
  const anyUnselected = aliases.some((alias) => !selection.includes(alias));
  return anyUnselected ? aliases : [];
}

/** The jump host as shown in the table: the alias, the existing connection's name, or null (none / unresolved). */
export function jumpLabel(jump: ImportJump | null): string | null {
  if (jump == null) return null;
  if (jump.type === "unresolved") return null;
  return jump.type === "existing" ? jump.name : jump.alias;
}

/** `user@host:port`, without `user@` when there is no user and without `:port` for port 22. */
export function candidateAddress(candidate: ImportCandidate): string {
  const target = candidate.host;
  const withUser = candidate.username != null ? `${candidate.username}@${target}` : target;
  return candidate.port === 22 ? withUser : `${withUser}:${candidate.port}`;
}
