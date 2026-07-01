import Link from "next/link";
import { VerdictBadge } from "@/components/viz";
import { DIM_NAMES, type DimName } from "@/engine/dims";
import { queryCells } from "@/engine/query";
import type { CellQuery, CubeRow } from "@/engine/types";
import { loadArtifacts } from "@/lib/artifacts";
import { cellPath, mult, pct, usd } from "@/lib/format";

/** Grain presets surfaced as chips (full registry works via ?grain=). */
const PRESETS: { label: string; grain: string }[] = [
  { label: "Platforms", grain: "platform" },
  { label: "Accounts", grain: "account" },
  { label: "Campaigns", grain: "campaign" },
  { label: "Adsets", grain: "adset" },
  { label: "Creative leaf", grain: "leaf" },
  { label: "Platform × audience", grain: "platform-audience" },
  { label: "Audience × creative", grain: "audience-creative" },
  { label: "Audiences", grain: "audience" },
  { label: "Creatives", grain: "creative" },
  { label: "Geos", grain: "geo" },
  { label: "Offers", grain: "offer" },
  { label: "★ Story cells", grain: "story-5" },
];

const COLUMNS: { key: CellQuery["metric"] | "path" | "verdict" | "cpl" | "cac" | "range" | "payback" | "evidence"; label: string; metric?: CellQuery["metric"]; title?: string }[] = [
  { key: "path", label: "Cell" },
  { key: "verdict", label: "Verdict" },
  { key: "spend", label: "Spend", metric: "spend" },
  { key: "cpl", label: "CPL" },
  { key: "cac", label: "CAC" },
  { key: "platform_roas", label: "Pixel ROAS", metric: "platform_roas", title: "What the ad platform claims — shown only next to the truth" },
  { key: "ltv_per_dollar", label: "True LTV:CAC", metric: "ltv_per_dollar" },
  { key: "range", label: "80% range" },
  { key: "payback", label: "Payback" },
  { key: "dollar_impact", label: "$ impact/day", metric: "dollar_impact" },
  { key: "flip_divergence", label: "Flip Δ", metric: "flip_divergence", title: "Distance between the pixel's story and the truth" },
  { key: "evidence", label: "Evidence" },
];

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const grain = one(sp.grain) ?? "campaign";
  const metric = (one(sp.sort) as CellQuery["metric"]) || "dollar_impact";
  const order = one(sp.order) === "asc" ? "asc" : "desc";
  const filters: Partial<Record<DimName, string>> = {};
  for (const d of DIM_NAMES) {
    const v = one(sp[`f_${d}`]);
    if (v) filters[d] = v;
  }

  const data = await loadArtifacts();
  const { rows, applied } = queryCells(data, {
    grain,
    filters,
    metric,
    order,
    min_confidence: 0, // show everything; low-evidence rows are muted, not hidden
    top_n: 200,
  });

  const qs = (over: Record<string, string | null>) => {
    const params = new URLSearchParams();
    params.set("grain", grain);
    if (metric) params.set("sort", metric);
    if (order === "asc") params.set("order", "asc");
    for (const [d, v] of Object.entries(filters)) params.set(`f_${d}`, v!);
    for (const [k, v] of Object.entries(over)) {
      if (v === null) params.delete(k);
      else params.set(k, v);
    }
    return `/explore?${params.toString()}`;
  };

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-xl font-semibold">Cell Explorer</h1>
        <span className="text-xs text-faint">
          {rows.length} cells at the <span className="text-muted">{applied.grain}</span> grain — low-evidence rows are muted, never hidden
        </span>
      </div>

      {/* Grain presets */}
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <Link
            key={p.grain}
            href={`/explore?grain=${p.grain}`}
            className={`text-xs px-2.5 py-1 rounded-full border ${
              p.grain === applied.grain
                ? "border-foreground/50 bg-raised text-foreground"
                : "border-line text-muted hover:text-foreground hover:border-faint"
            }`}
          >
            {p.label}
          </Link>
        ))}
      </div>

      {/* Active filters */}
      {Object.keys(filters).length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-faint">Filtered:</span>
          {Object.entries(filters).map(([d, v]) => (
            <Link
              key={d}
              href={qs({ [`f_${d}`]: null })}
              className="px-2 py-0.5 rounded-full border border-untapped/40 text-untapped bg-untapped/10 hover:border-untapped"
              title="Click to remove"
            >
              {d}: {v} ✕
            </Link>
          ))}
          <Link href={`/explore?grain=${grain}`} className="text-faint hover:text-foreground ml-1">
            clear all
          </Link>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-line overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface text-left">
              {COLUMNS.map((c) => (
                <th key={c.key} className="px-3 py-2.5 font-medium text-xs text-muted whitespace-nowrap" title={c.title}>
                  {c.metric ? (
                    <Link
                      href={qs({ sort: c.metric, order: metric === c.metric && order === "desc" ? "asc" : "desc" })}
                      className={`hover:text-foreground ${metric === c.metric ? "text-foreground" : ""}`}
                    >
                      {c.label}
                      {metric === c.metric ? (order === "desc" ? " ↓" : " ↑") : ""}
                    </Link>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Row key={r.cell_key} r={r} />
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-muted text-sm">
                  No cells match these filters at this grain — try removing a filter or picking a coarser grain.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ r }: { r: CubeRow }) {
  const lowEvidence = r.verdict === "WATCH";
  return (
    <tr className={`border-b border-line/50 hover:bg-raised/60 ${lowEvidence ? "opacity-50" : ""}`}>
      <td className="px-3 py-2 max-w-[26rem]">
        <Link href={`/cell/${r.cell_key}`} className="hover:underline underline-offset-4">
          {cellPath(r.dims)}
        </Link>
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <VerdictBadge verdict={r.verdict} leaning={r.leaning} isFlip={r.is_flip} />
      </td>
      <td className="px-3 py-2 whitespace-nowrap">{usd(r.spend_c, { compact: true })}</td>
      <td className="px-3 py-2 whitespace-nowrap text-muted">{r.n_subs > 0 ? usd(r.cpl_c) : "—"}</td>
      <td className="px-3 py-2 whitespace-nowrap text-muted">{r.cac_c > 0 ? usd(r.cac_c) : "—"}</td>
      <td className="px-3 py-2 whitespace-nowrap text-faint">{mult(r.platform_roas)}</td>
      <td className={`px-3 py-2 whitespace-nowrap font-semibold ${r.ltv_shrunk >= 1 ? "text-scale" : "text-kill"}`}>
        {mult(r.ltv_shrunk)}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-faint">
        {mult(r.ci_low, 1)}–{mult(r.ci_high, 1)}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-muted">
        {r.payback_day !== null ? `d${r.payback_day}` : "—"}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        {r.dollar_impact_day_c > 0 ? (
          <span className={r.verdict === "KILL" || r.verdict === "TRIM" ? "text-kill" : "text-scale"}>
            {usd(r.dollar_impact_day_c)}
          </span>
        ) : (
          <span className="text-faint">—</span>
        )}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-faint">{mult(Math.abs(r.platform_roas - r.ltv_shrunk), 1)}</td>
      <td className="px-3 py-2 whitespace-nowrap text-faint text-[11px]">
        n={r.n_subs.toLocaleString("en-US")} · {pct(r.confidence)} conf
      </td>
    </tr>
  );
}
