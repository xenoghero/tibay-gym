"use client";
import type { Person } from "@/lib/db/person";
import { PurchaseForm } from "./purchase-form";
export function ConvertToMemberForm({ person }: { person: Person }) {
  return <section><h2>{person.name}</h2><p>Existing visits, weights and card ownership stay on this profile. Membership activates after payment approval.</p><PurchaseForm admin personId={person.id} /></section>;
}
