import Link from "next/link";

interface BackLinkProps {
  href: string;
  label: string;
}

export function BackLink({ href, label }: BackLinkProps) {
  return (
    <Link href={href} className="rs-back-link" aria-label={label}>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        width="16"
        height="16"
        fill="none"
      >
        <path d="M16 10H4M9 5l-5 5 5 5" />
      </svg>
      <span>{label}</span>
    </Link>
  );
}
