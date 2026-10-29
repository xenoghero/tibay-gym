"use client";

import { BrandLogo } from "@/components/brand-logo";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { IconOverview, IconPeople, IconStatistics, IconAudit, IconPayment, IconMessage, IconQr, IconSettings, IconSignOut, IconPanel, IconMenu, IconClose } from "./nav-icons";
import styles from "./dashboard-nav.module.css";

const NAV = [
  { label: "Overview", href: "/dashboard", Icon: IconOverview },
  { label: "People", href: "/dashboard/people", Icon: IconPeople },
  { label: "Statistics", href: "/dashboard/statistics", Icon: IconStatistics },
  { label: "Audit history", href: "/dashboard/audit", Icon: IconAudit },
  { label: "Payment review", href: "/dashboard/payments", Icon: IconPayment },
  { label: "SMS operations", href: "/dashboard/sms", Icon: IconMessage },
  { label: "QR codes", href: "/dashboard/print-qr", Icon: IconQr },
  { label: "Account Settings", href: "/dashboard/settings", Icon: IconSettings },
];
const STORAGE_KEY = "tibay-sidebar-collapsed";
const CHANGE_EVENT = "tibay-sidebar-change";
let fallbackCollapsed = false;
function readCollapsed() {
  try { return window.localStorage.getItem(STORAGE_KEY) === "true"; }
  catch { return fallbackCollapsed; }
}
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}
const serverSnapshot = () => false;

export function DashboardNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, serverSnapshot);
  const drawer = useRef<HTMLDialogElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerClosing, setDrawerClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const activeIndex = NAV.findIndex(({ href }) => pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`)));

  const finishClosing = useCallback(() => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    drawer.current?.close();
    setDrawerClosing(false);
  }, []);

  const closeDrawer = useCallback(() => {
    if (!drawer.current?.open || closeTimer.current !== null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finishClosing();
      return;
    }
    setDrawerClosing(true);
    // Fallback if the animation is interrupted or its end event is missed.
    closeTimer.current = setTimeout(finishClosing, 250);
  }, [finishClosing]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) closeDrawer(); });
    return () => { active = false; };
  }, [pathname, closeDrawer]);
  useEffect(() => () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 861px)");
    const closeOnDesktop = () => { if (media.matches) finishClosing(); };
    media.addEventListener("change", closeOnDesktop);
    return () => media.removeEventListener("change", closeOnDesktop);
  }, [finishClosing]);

  function toggleCollapsed() {
    fallbackCollapsed = !collapsed;
    try { window.localStorage.setItem(STORAGE_KEY, String(fallbackCollapsed)); } catch { /* Keep the control usable when storage is unavailable. */ }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
  async function handleSignOut() {
    setSigningOut(true);
    setSignOutError(false);
    try { await signOut(); router.replace("/login"); }
    catch { setSignOutError(true); setSigningOut(false); }
  }

  function contents(mobile: boolean) {
    const compact = collapsed && !mobile;
    return <>
      <div className={styles.brandRow}>
        <div className={styles.brandClip}><BrandLogo sidebar /></div>
        {mobile && <button type="button" className={styles.control} aria-label="Close navigation" onClick={closeDrawer}><IconClose /></button>}
      </div>
      {!mobile && <button type="button" className={`${styles.collapse} ${styles.tipTarget}`} aria-label={compact ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!compact} onClick={toggleCollapsed}>
        <IconPanel /><span className={styles.label}>Collapse sidebar</span>
        {compact && <span className={styles.tooltip} aria-hidden="true">Expand sidebar</span>}
      </button>}
      <nav className={styles.nav} aria-label={mobile ? "Mobile navigation" : "Sidebar navigation"}>
        {activeIndex >= 0 && <span aria-hidden="true" className={styles.activeIndicator} style={{ "--active-index": activeIndex } as CSSProperties} />}
        {NAV.map(({ href, label, Icon }, index) => <Link key={href} href={href} className={`${styles.link} ${styles.tipTarget}`} aria-label={label} aria-current={index === activeIndex ? "page" : undefined} onClick={() => { if (mobile) closeDrawer(); }}>
          <Icon size={20} /><span className={styles.label}>{label}</span>
          {compact && <span className={styles.tooltip} aria-hidden="true">{label}</span>}
        </Link>)}
      </nav>
      <div className={styles.footer}>
        <div className={styles.identity} title={user?.email ?? undefined}>
          <div className={styles.avatar}>{(user?.email ?? "?").slice(0, 2).toUpperCase()}</div>
          <div className={styles.identityDetails}><div className={styles.email}>{user?.email ?? "—"}</div><div className={styles.role}>Owner / Admin</div></div>
        </div>
        <button type="button" className={`${styles.signOut} ${styles.tipTarget}`} aria-label={signingOut ? "Signing out" : "Sign out"} disabled={signingOut} onClick={handleSignOut}>
          <IconSignOut /><span className={styles.label}>{signingOut ? "Signing out…" : "Sign out"}</span>
          {compact && <span className={styles.tooltip} aria-hidden="true">Sign out</span>}
        </button>
        {signOutError && <p className={styles.error} role="alert">Sign out failed. Please retry.</p>}
      </div>
    </>;
  }

  return <>
    <aside className={`rs-dashboard-sidebar ${styles.sidebar}`} data-collapsed={collapsed}>{contents(false)}</aside>
    <header className={styles.mobileHeader}>
      <BrandLogo sidebar />
      <button type="button" className={styles.control} aria-label="Open navigation" aria-haspopup="dialog" aria-controls="dashboard-navigation-drawer" aria-expanded={drawerOpen} onClick={() => { drawer.current?.showModal(); setDrawerOpen(true); }}><IconMenu /></button>
    </header>
    <dialog id="dashboard-navigation-drawer" ref={drawer} className={styles.drawer} data-closing={drawerClosing} aria-label="Navigation"
      onClose={() => { setDrawerOpen(false); setDrawerClosing(false); }}
      onCancel={event => { event.preventDefault(); closeDrawer(); }}
      onAnimationEnd={event => { if (drawerClosing && event.target === event.currentTarget) finishClosing(); }}
      onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDrawer(); } }}>
      <div className={styles.drawerContent}>{contents(true)}</div>
    </dialog>
  </>;
}
