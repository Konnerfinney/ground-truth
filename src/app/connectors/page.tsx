import { connectorStatuses } from "@/connectors/registry";
import { META_API_VERSION } from "@/connectors/meta";

export const dynamic = "force-dynamic"; // status reflects the deployment's env

const PLATFORM_COPY: Record<string, { title: string; how: string }> = {
  meta: {
    title: "Meta (Facebook / Instagram)",
    how: `Marketing API ${META_API_VERSION}, ad-level Insights with the delivery-breakdown trio. A System User token on your own Business Manager (scope: ads_read) needs no app review.`,
  },
  google: {
    title: "Google Ads / YouTube",
    how: "Google Ads API (GAQL reports) — API adapter is the post-contest step; the CSV adapter covers it today.",
  },
  tiktok: {
    title: "TikTok",
    how: "TikTok Marketing API reporting — API adapter is the post-contest step; the CSV adapter covers it today.",
  },
  taboola: {
    title: "Taboola (native)",
    how: "Backstage API — API adapter is the post-contest step; the CSV adapter covers it today.",
  },
  csv: {
    title: "CSV import (any platform)",
    how: "Every platform exports CSV. Standard headers (date, campaign, adset, ad, spend, …) normalize through the exact same contract as the APIs.",
  },
};

export default function ConnectorsPage() {
  const statuses = connectorStatuses();
  const anyLive = statuses.some((s) => s.kind === "api" && s.configured);

  return (
    <div className="max-w-3xl space-y-8">
      <header className="space-y-3">
        <h1 className="font-display text-3xl">Connectors</h1>
        <p className="text-muted text-sm leading-relaxed">
          Production ingestion, stream by stream: spend arrives through these connectors, the
          subscriber join arrives through the <code className="text-untapped">/c</code> click rail,
          and revenue arrives through payment/ESP/affiliate postbacks. Connector credentials are
          <b> environment secrets per deployment</b> — a connector is live the moment its variables
          exist, and the nightly sync (07:00 UTC) lands normalized rows in the raw store.
        </p>
        {!anyLive && (
          <p className="text-[13px] px-3 py-2 rounded-lg border border-untapped/40 bg-untapped/10 text-untapped">
            ⚗ This deployment has no ad-platform credentials configured — it serves the documented
            synthetic world. That is the demo&apos;s design, not a limitation: nothing here can be
            down, expired, or rate-limited while you&apos;re evaluating it.
          </p>
        )}
      </header>

      <div className="grid gap-3">
        {statuses.map((s) => (
          <div key={s.platform} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-medium">{PLATFORM_COPY[s.platform]?.title ?? s.platform}</span>
              {s.kind === "csv" ? (
                <span className="text-[11px] px-2 py-0.5 rounded border border-scale/40 text-scale bg-scale/10">
                  READY — no credentials needed
                </span>
              ) : s.configured ? (
                <span className="text-[11px] px-2 py-0.5 rounded border border-scale/40 text-scale bg-scale/10">
                  CONFIGURED
                </span>
              ) : (
                <span className="text-[11px] px-2 py-0.5 rounded border border-watch/40 text-watch bg-watch/10">
                  AWAITING CREDENTIALS
                </span>
              )}
            </div>
            <p className="text-[13px] text-muted mt-2 leading-relaxed">
              {PLATFORM_COPY[s.platform]?.how}
            </p>
            {s.kind === "api" && !s.configured && (
              <p className="text-[11px] text-faint mt-2">
                needs env: {s.needs.map((n) => (
                  <code key={n} className="mr-2">{n}</code>
                ))}
              </p>
            )}
          </div>
        ))}
      </div>

      <section className="space-y-2 text-sm text-muted leading-relaxed">
        <h2 className="text-lg font-semibold text-foreground">The other two streams</h2>
        <p>
          <b>Acquisition join:</b> a <code>/c</code> edge redirect stamps every click with a
          click-id carrying the full cell (platform macros fill campaign/adset/ad/placement at
          serve time); the landing page carries it into the ESP. <b>Revenue:</b> payment-processor
          webhooks (sales, renewals, <i>refunds</i> — the events platforms never see), ESP/SMS
          engagement streams (also the model&apos;s early-behavior features), and affiliate S2S
          postbacks keyed by the same click-id, each tagged with a match-confidence tier.
        </p>
        <p className="text-[13px] text-faint">
          Semantic dimensions (audience, angle, offer) ride on the naming convention —{" "}
          <code>aud:retirement | ang:education | off:core-99</code> in campaign/adset/ad names —
          parsed by the same code the CSV and API adapters share. Multi-workspace credential
          storage (encrypted vault behind real auth) is the documented next step in{" "}
          <code>docs/CONNECTORS.md</code>.
        </p>
      </section>
    </div>
  );
}
