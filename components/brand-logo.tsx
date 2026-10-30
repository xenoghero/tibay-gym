import Image from "next/image";

/** Hero and sidebar branding share the tightly framed, transparent mark. */
export function BrandLogo({ hero = false, sidebar = false, className = "" }: { hero?: boolean; sidebar?: boolean; className?: string }) {
  const transparentMark = hero || sidebar;
  return (
    <div className={`rs-brand ${hero ? "rs-brand-hero" : ""} ${sidebar ? "rs-brand-sidebar" : ""} ${className}`}>
      <Image src={transparentMark ? "/tibay-gym-mark-transparent.svg" : "/tibay-gym-logo.svg"} alt="" width={transparentMark ? 628 : 700} height={transparentMark ? 429 : 490} loading="eager" className="rs-brand-mark" />
      <span className="rs-brand-name">Tibay <span>Gym</span></span>
    </div>
  );
}
