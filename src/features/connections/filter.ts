export interface Filterable {
  name: string;
  host: string;
  username: string | null;
  tags: readonly string[];
}

export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export function matchesQuery(item: Filterable, query: string): boolean {
  const terms = normalizeForSearch(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return true;
  }
  const haystack = normalizeForSearch(
    [item.name, item.host, item.username ?? "", ...item.tags].join(" "),
  );
  return terms.every((term) => haystack.includes(term));
}

export function filterConnections<T extends Filterable>(items: readonly T[], query: string): T[] {
  return items.filter((item) => matchesQuery(item, query));
}
