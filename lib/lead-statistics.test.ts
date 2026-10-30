import { expect, it } from "vitest";
import { Timestamp } from "firebase/firestore";
import type { Person } from "@/lib/db/person";
import { computeLeadStatistics } from "./lead-statistics";

function person(id: string, extra: Partial<Person> = {}): Person {
  return { id, name: id, phone: "09000000000", type: "guest", status: null, membershipExpiry: null,
    rfidTagId: null, joinDate: null, visitCount: 20, lastVisitAt: null,
    createdAt: Timestamp.fromMillis(100), updatedAt: Timestamp.fromMillis(100), ...extra };
}

it("counts unique profiles within creation boundaries, independently of visits and current type", () => {
  const member = person("member", { type: "member", leadSource: "facebook" });
  const stats = computeLeadStatistics([member, member, person("guest", { leadSource: "facebook" }),
    person("old", { createdAt: Timestamp.fromMillis(99) }), person("end", { createdAt: Timestamp.fromMillis(200) }),
    person("deleting", { deletingAt: Timestamp.fromMillis(150) })], { start: Timestamp.fromMillis(100), end: Timestamp.fromMillis(200) });
  expect(stats.total).toBe(2);
  expect(stats.sources.find(source => source.key === "facebook")).toMatchObject({ total: 2, members: 1, guests: 1 });
  expect(stats.recorded).toBe(2);
});

it("keeps missing sources in the denominator and exposes ties and other answers", () => {
  const stats = computeLeadStatistics([person("1"), person("2", { leadSource: "ads" }),
    person("3", { leadSource: "facebook" }), person("4", { leadSource: "others", leadSourceOther: " Local event " })], null);
  expect(stats.total).toBe(4);
  expect(stats.recorded).toBe(3);
  expect(stats.leaders).toHaveLength(3);
  expect(stats.sources.find(source => source.key === "unknown")?.total).toBe(1);
  expect(stats.otherDetails).toEqual([["Local event", 1]]);
  expect(stats.sources.reduce((sum, source) => sum + source.total, 0)).toBe(stats.total);
});

it("handles an empty cohort and an entirely unknown cohort", () => {
  expect(computeLeadStatistics([], null)).toMatchObject({ total: 0, recorded: 0, leaders: [] });
  expect(computeLeadStatistics([person("1")], null)).toMatchObject({ total: 1, recorded: 0, leaders: [] });
});
