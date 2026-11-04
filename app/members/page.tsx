import { CustomerAccess } from "@/components/checkin/customer-access";

export const metadata = {
  title: "Membership payment setup — Tibay Gym",
  description: "Start your Tibay Gym membership and review your payment setup.",
};

export default function MembersPage() {
  return <CustomerAccess membershipSetup />;
}
