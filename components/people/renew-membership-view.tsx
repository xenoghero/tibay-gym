"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { watchPerson, type Person } from "@/lib/db/person";
import { PeopleFormShell } from "./people-form-shell";
import { PurchaseForm } from "./purchase-form";
export function RenewMembershipView({ personId }: { personId: string }) {
  const [person, setPerson] = useState<Person | null>(), [error, setError] = useState(false);
  useEffect(() => watchPerson(personId, setPerson, () => setError(true)), [personId]);
  return <PeopleFormShell title="Renew membership" backHref="/dashboard/people" backLabel="Back to people">
    {error ? <p role="alert">Could not load membership. Refresh this page to retry.</p> : person === undefined ? <p>Loading membership…</p> : !person ? <p>Profile not found.</p> : person.type !== "member" ? <p>This customer is a guest. <Link href={`/dashboard/people/${person.id}/convert`}>Add membership</Link></p> : <RenewMembershipForm person={person} onReload={() => window.location.reload()} />}
  </PeopleFormShell>;
}
export function RenewMembershipForm({ person, onReload }: { person: Person; onReload: () => void }) {
  return <section><h2>{person.name}</h2><p>Paid renewals activate only after explicit administrator payment approval.</p><PurchaseForm admin personId={person.id} /><button onClick={onReload}>Reload membership</button><Link href="/dashboard/payments">Open payment review</Link></section>;
}
