"use client";

import portal from "@/components/checkin/customer-access.module.css";
import { useCoach } from "../coach-shell";
import { CoachClients } from "../coach-clients";
import { SessionTools } from "../session-tools";
import styles from "../coach.module.css";

export default function CoachClientsPage() {
  const { user, profile } = useCoach();
  return <main className={`${portal.portal} ${styles.pane}`}>
    <CoachClients user={user} coachName={profile.name}>{(client, reload) => <SessionTools user={user} coachId={profile.id} client={client} onChanged={reload} />}</CoachClients>
  </main>;
}
