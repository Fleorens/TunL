import { describe, expect, it } from "vitest";
import { filterConnections, matchesQuery } from "./filter";

const items = [
  { name: "web-01", host: "10.0.0.12", username: "deploy", tags: ["prod", "web"] },
  { name: "db-prod", host: "db.internal", username: "root", tags: ["prod", "pg"] },
  { name: "ad-01", host: "10.0.0.5", username: "admin", tags: ["windows"] },
];

describe("filterConnections", () => {
  it("returns everything for an empty query, as a new array", () => {
    const result = filterConnections(items, "");
    expect(result).toHaveLength(3);
    expect(result).not.toBe(items);
  });

  it("matches a connection by its tag", () => {
    expect(filterConnections(items, "prod").map((i) => i.name)).toContain("web-01");
  });

  it("matches a username ignoring accents and case", () => {
    expect(matchesQuery(items[0], "DÉPLOY")).toBe(true);
  });

  it("requires every term", () => {
    expect(filterConnections(items, "web 10.0").map((i) => i.name)).toEqual(["web-01"]);
  });

  it("returns nothing when no term matches", () => {
    expect(filterConnections(items, "zzz")).toEqual([]);
  });
});
