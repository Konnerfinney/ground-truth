import Link from "next/link";
import { AddToProposal } from "@/components/cart/CartClient";
import { cartItemFor } from "@/components/cart/item";
import { BulletBar, Dumbbell, ImpactMoney, MaturityBadge, StatTile, VerdictBadge } from "@/components/viz";
import type { BriefCard, CubeRow, Verdict } from "@/engine/types";
import { loadArtifacts } from "@/lib/artifacts";
import { cellPath, mult, usd } from "@/lib/format";

export const dynamic = "force-static";

const GROUP_ORDER: Verdict[] = ["KILL", "TRIM", "SCALE", "UNTAPPED"];
const GROUP_COPY: Record<string, { title: string; blurb: string }> = {
  KILL: { title: "Kill", blurb: "Loses money even in the best case. Stop feeding it." },
  TRIM: { title: "Trim", blurb: "Below break-even at high spend — first place to pull back." },
  SCALE: { title: "Scale", blurb: "Even the LOW end of the range clears break-even with margin." },
  UNTAPPED: { title: "Untapped", blurb: "Barely funded, but its traits predict outsized value. Worth a test." },
};

export default async function BriefPage() {
  const data = await loadArtifacts();
  const { brief } = data;
  const global = data.rows.find((r) => r.grain === "global")!;
  const flipMoves = brief.cards.filter((c) => c.is_flip).length;

  const groups = GROUP_ORDER.map((v) => ({
    verdict: v,
    cards: brief.cards
      .filter((c) => c.verdict === v)
      .sort((a, b) => b.dollar_impact_day_c - a.dollar_impact_day_c),
  })).filter((g) => g.cards.length > 0);

  return (
    <div className="space-y-8">
      {/* Portfolio strip */}
      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatTile label="Spend (18 wks)" value={usd(global.spend_c, { compact: true })} sub={`${global.n_subs.toLocaleString("en-US")} subscribers`} />
        <StatTile
          label="Pixel MER vs true MER"
          value={`${mult(global.platform_roas, 1)} → ${mult(global.ltv_shrunk, 1)}`}
          sub="what platforms claim vs 90-day truth"
        />
        <StatTile label="Bleeding" value={`${usd(brief.headline_bleed_c)}/day`} sub="measured, across kill/trim cells" tone="kill" />
        <StatTile label="Potential upside" value={`+${usd(brief.headline_upside_c)}/day`} sub="naive marginal estimate, unverified" tone="scale" />
        <StatTile label="Flips in today's moves" value={String(flipMoves)} sub="platform winners that truly lose" tone="untapped" />
      </section>

      {/* Headline */}
      <section>
        <h1 className="font-display text-3xl md:text-4xl leading-snug max-w-3xl">
          Bleeding <span className="text-kill">{usd(brief.headline_bleed_c)}/day</span>;{" "}
          <span className="text-scale">+{usd(brief.headline_upside_c)}/day</span> potential upside.{" "}
          <span className="text-muted">{brief.cards.length} moves.</span>
        </h1>
        <p className="text-sm text-muted mt-2 max-w-2xl">
          Verdicts gate on the uncertainty range, never the point estimate — and every dollar is
          counted once, at the leaf level. Upside assumes flat marginal CAC and says so.
        </p>
      </section>

      {/* Verdict groups */}
      {groups.map((g) => (
        <section key={g.verdict} className="space-y-3">
          <div className="flex items-baseline gap-3">
            <h2 className="text-lg font-semibold">{GROUP_COPY[g.verdict].title}</h2>
            <span className="text-xs text-faint">{GROUP_COPY[g.verdict].blurb}</span>
          </div>
          <div className="grid gap-3">
            {g.cards.map((c) => (
              <DecisionCard key={c.cell_key} card={c} row={data.byKey.get(c.cell_key)!} />
            ))}
          </div>
        </section>
      ))}

      <p className="text-xs text-faint">
        Snapshot {data.meta.snapshot_at.slice(0, 10)} · seed {data.meta.seed} · every number
        precomputed by the engine — the UI and the MCP agent read the same rows and cannot disagree.
      </p>
    </div>
  );
}

function explorerHref(row: CubeRow): string {
  const params = new URLSearchParams({ grain: row.grain });
  for (const [d, v] of Object.entries(row.dims)) {
    if (v) params.set(`f_${d}`, v);
  }
  return `/explore?${params.toString()}`;
}

function DecisionCard({ card, row }: { card: BriefCard; row: CubeRow }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 hover:border-faint transition-colors">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <VerdictBadge verdict={row.verdict} leaning={row.leaning} isFlip={row.is_flip} />
        <Link href={`/cell/${row.cell_key}`} className="font-medium hover:underline underline-offset-4">
          {cellPath(row.dims)}
        </Link>
        <span className="ml-auto">
          <ImpactMoney cents={card.dollar_impact_day_c} kind={card.kind} />
        </span>
      </div>

      <div className="mt-3 grid md:grid-cols-[1fr_auto_auto] gap-x-8 gap-y-2 items-center">
        <BulletBar value={row.ltv_shrunk} lo={row.ci_low} hi={row.ci_high} verdict={row.verdict} />
        <Dumbbell platformRoas={row.platform_roas} truth={row.ltv_shrunk} />
        <div className="text-right space-y-1">
          <MaturityBadge row={row} />
          {card.kind === "upside" && (
            <div className="text-[11px] text-faint" title="Assumes the next dollar performs like the last one — a naive marginal estimate, labeled as such.">
              est. basis: flat marginal CAC
            </div>
          )}
        </div>
      </div>

      <p className="mt-3 text-sm text-muted leading-relaxed">{card.reason}</p>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-faint">
        <span>covers {card.covered_leaves.toLocaleString("en-US")} live cells</span>
        {card.also_visible_at.length > 0 && (
          <span title="The same dollars, seen from other grains — corroboration, not double-counting.">
            also visible at {card.also_visible_at.length} other grain{card.also_visible_at.length > 1 ? "s" : ""}
          </span>
        )}
        <span className="ml-auto flex items-center gap-3">
          {cartItemFor(row) && <AddToProposal item={cartItemFor(row)!} />}
          <Link href={explorerHref(row)} className="text-muted hover:text-foreground">
            open in Explorer →
          </Link>
        </span>
      </div>
    </div>
  );
}
