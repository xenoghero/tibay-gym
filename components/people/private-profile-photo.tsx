"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
export function PrivateProfilePhoto({ personId }: { personId: string }) {
  const { user } = useAuth(); const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true, objectUrl: string | null = null;
    if (user) user.getIdToken().then(token => fetch(`/api/images/profile?personId=${encodeURIComponent(personId)}`, { headers: { Authorization: `Bearer ${token}` } }))
      .then(async response => { if (!response.ok) return; const blob = await response.blob(); if (!active) return; objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }).catch(() => {});
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [user, personId]);
  return url ? <Image src={url} width={96} height={96} unoptimized alt="Private customer profile photo" style={{ objectFit: "cover", borderRadius: 8 }} /> : <span>Photo unavailable</span>;
}
