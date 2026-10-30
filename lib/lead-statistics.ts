import type { Person } from "@/lib/db/person";
import type { DateRange } from "@/lib/dates";
import { LEAD_SOURCES } from "@/lib/registration";

/** Acquisition is one official profile, dated by creation, never by repeat visits. */
export function computeLeadStatistics(people: Person[], range: DateRange | null) {
  const unique = new Map(people.map(person => [person.id, person]));
  const clients = [...unique.values()].filter(person => !person.deletingAt && (!range || (
    person.createdAt?.toMillis() >= range.start.toMillis() && person.createdAt?.toMillis() < range.end.toMillis()
  )));
  const sources = [...LEAD_SOURCES.map(([key, label]) => ({ key: String(key), label, total: 0, members: 0, guests: 0 })),
    { key: "unknown", label: "Not recorded", total: 0, members: 0, guests: 0 }];
  const otherDetails = new Map<string, number>();
  for (const person of clients) {
    const bucket = sources.find(source => source.key === person.leadSource) ?? sources[sources.length - 1];
    bucket.total++;
    if (person.type === "member") bucket.members++; else bucket.guests++;
    if (bucket.key === "others" && person.leadSourceOther?.trim()) {
      const detail = person.leadSourceOther.trim();
      otherDetails.set(detail, (otherDetails.get(detail) ?? 0) + 1);
    }
  }
  sources.sort((a, b) => b.total - a.total);
  const recorded = clients.length - sources.find(source => source.key === "unknown")!.total;
  const top = sources.filter(source => source.key !== "unknown" && source.total > 0);
  const leaders = top.filter(source => source.total === top[0]?.total);
  return { total: clients.length, recorded, sources, leaders,
    otherDetails: [...otherDetails].sort((a, b) => b[1] - a[1]) };
}
