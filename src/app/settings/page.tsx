import Link from "next/link";
import { connectorStatuses } from "@/connectors/registry";
import { authConfigured, getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * The authenticated area — today: your session + workspace preview; next:
 * the encrypted connector-credential vault (docs/CONNECTORS.md roadmap).
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const authError = typeof sp.auth_error === "string" ? sp.auth_error : null;

  if (!authConfigured()) {
    return (
      <div className="max-w-2xl space-y-3">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted leading-relaxed">
          Sign-in is not configured on this deployment. This demo runs authless by design — nothing
          to expire or fail while it&apos;s being judged. To enable it, set{" "}
          <code>GOOGLE_OAUTH_CLIENT_ID</code>, <code>GOOGLE_OAUTH_CLIENT_SECRET</code> and{" "}
          <code>AUTH_SECRET</code> (see <code>docs/CONNECTORS.md</code>).
        </p>
      </div>
    );
  }

  const user = await getSession();
  if (!user) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-xl font-semibold">Settings</h1>
        {authError && (
          <p className="text-[13px] px-3 py-2 rounded-lg border border-kill/40 bg-kill/10 text-kill">
            Sign-in didn&apos;t complete ({authError.replaceAll("_", " ")}). Try again.
          </p>
        )}
        <p className="text-sm text-muted">Sign in to manage your workspace.</p>
        <a
          href="/api/auth/login"
          className="inline-block text-sm px-4 py-2 rounded-md border border-line hover:border-faint"
        >
          Sign in with Google
        </a>
      </div>
    );
  }

  const statuses = connectorStatuses();

  return (
    <div className="max-w-2xl space-y-8">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted">
          Signed in as <span className="text-foreground">{user.name}</span> ({user.email})
        </p>
      </header>

      <section className="rounded-xl border border-line bg-surface p-4 space-y-2">
        <h2 className="text-sm font-semibold">Workspace</h2>
        <p className="text-[13px] text-muted leading-relaxed">
          Your workspace key is your Google account id. Connector credentials for this workspace
          will live here next — encrypted at rest (AES-256-GCM, envelope keys), write-only through
          this page, presence-and-last-used visible, values never. Until that ships, connectors are
          configured per deployment via environment secrets:
        </p>
        <ul className="text-[13px] text-muted space-y-1">
          {statuses.map((s) => (
            <li key={s.platform} className="flex items-center gap-2">
              <span className={s.kind === "csv" || s.configured ? "text-scale" : "text-watch"}>●</span>
              <span className="text-foreground">{s.platform}</span>
              <span className="text-faint">
                {s.kind === "csv" ? "ready (no credentials)" : s.configured ? "configured" : "awaiting credentials"}
              </span>
            </li>
          ))}
        </ul>
        <Link href="/connectors" className="text-[13px] text-untapped hover:underline underline-offset-4">
          connector setup →
        </Link>
      </section>

      <form action="/api/auth/logout" method="post">
        <button
          type="submit"
          className="text-sm px-4 py-2 rounded-md border border-line text-muted hover:text-kill hover:border-kill/40"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
