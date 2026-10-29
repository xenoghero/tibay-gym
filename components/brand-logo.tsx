import Image from "next/image";

/** The sidebar uses a tightly framed mark with its black backdrop suppressed. */
export function BrandLogo({ hero = false, sidebar = false, className = "" }: { hero?: boolean; sidebar?: boolean; className?: string }) {
  return (
    <div className={`rs-brand ${hero ? "rs-brand-hero" : ""} ${sidebar ? "rs-brand-sidebar" : ""} ${className}`}>
      <Image src={sidebar ? "/tibay-gym-mark-transparent.svg" : "/tibay-gym-logo.svg"} alt="" width={sidebar ? 628 : 700} height={sidebar ? 429 : 490} loading="eager" className="rs-brand-mark" />
      <span className="rs-brand-name">Tibay <span>Gym</span></span>
    </div>
  );
}
