import Image from "next/image";

/** The supplied mark stays on black so its silver detail reads in either theme. */
export function BrandLogo({ hero = false, className = "" }: { hero?: boolean; className?: string }) {
  return (
    <div className={`rs-brand ${hero ? "rs-brand-hero" : ""} ${className}`}>
      <Image src="/tibay-gym-logo.svg" alt="Tibay Gym logo" width={700} height={490} loading="eager" className="rs-brand-mark" />
      <span className="rs-brand-name">Tibay <span>Gym</span></span>
    </div>
  );
}
