"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Header auth chip. Client island so static pages STAY static (a server
 * cookie read in the root layout would force every page dynamic). Renders
 * nothing until the probe answers, and nothing at all on deployments where
 * auth isn't configured — the judged demo is unaffected by construction.
 */

interface Me {
  configured: boolean;
  user: { email: string; name: string; picture: string | null } | null;
}

export function AuthChip() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then(setMe)
      .catch(() => setMe({ configured: false, user: null }));
  }, []);

  if (!me?.configured) return null;

  if (!me.user) {
    return (
      <a
        href="/api/auth/login"
        className="text-[11px] px-2.5 py-1 rounded-full border border-line text-muted hover:text-foreground hover:border-faint whitespace-nowrap"
      >
        Sign in with Google
      </a>
    );
  }

  return (
    <Link href="/settings" className="flex items-center gap-1.5 min-w-0" title={me.user.email}>
      {me.user.picture ? (
        // eslint-disable-next-line @next/next/no-img-element -- tiny avatar, remote domain varies
        <img src={me.user.picture} alt="" className="h-5 w-5 rounded-full border border-line" />
      ) : (
        <span className="h-5 w-5 rounded-full bg-raised border border-line inline-flex items-center justify-center text-[9px] text-muted">
          {me.user.name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="text-[11px] text-muted truncate max-w-[8rem] hidden sm:inline">{me.user.name}</span>
    </Link>
  );
}
