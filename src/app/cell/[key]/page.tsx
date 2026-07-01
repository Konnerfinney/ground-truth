import Link from "next/link";
import { notFound } from "next/navigation";
import { BulletBar, Dumbbell, MaturityBadge, StatTile, VerdictBadge } from "@/components/viz";
import { getCell } from "@/engine/query";
import { loadArtifacts } from "@/lib/artifacts";
import { cellPath, mult, pct, usd } from "@/lib/format";

export default async function CellPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const data = await loadArtifacts();
  const detail = getCell(data, key);
  if (!detail) notFound();
  const { cell, series, effects_for_dims, children_preview, parent_chain } = detail;

  return (
    <div className="space-y-8">
      {/* Breadcrumb = the cell path, each ancestor clickable */}
      <nav className="text-xs text-faint flex flex-wrap gap-1.5 items-center">
        {[...parent_chain].reverse().map((p) => (
          <span key={p.cell_key} className="flex items-center gap-1.5">
            <Link href={`/cell/${p.cell_key}`} className="hover:text-foreground">
              {p.grain === "global" ? "portfolio" : cellPath(p.dims)}
            </Link>
            <span>›</span>
          </span>
        ))}
        <span className="text-muted">{cellPath(cell.dims)}</span>
      </nav>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-4">
          <VerdictBadge verdict={cell.verdict} leaning={cell.leaning} isFlip={cell.is_flip} />
          <h1 className="text-2xl font-semibold">{cellPath(cell.dims)}</h1>
        </div>
        <p className="text-sm text-muted max-w-3xl leading-relaxed">{cell.reason}</p>
      </header>

      {/* The flip, stated visually */}
      <section className="rounded-xl border border-line bg-surface p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-faint mb-1">
              What the pixel claims vs what the back end pays
            </div>
            <Dumbbell platformRoas={cell.platform_roas} truth={cell.ltv_shrunk} />
          </div>
          <div className="grow max-w-xl">
            <div className="text-[11px] uppercase tracking-wider text-faint mb-1">
              True LTV:CAC with 80% uncertainty range
            </div>
            <BulletBar value={cell.ltv_shrunk} lo={cell.ci_low} hi={cell.ci_high} verdict={cell.verdict} />
          </div>
          <MaturityBadge row={cell} />
        </div>
      </section>

      {/* Numbers grid */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Spend" value={usd(cell.spend_c, { compact: true })} sub={`${usd(cell.last_week_spend_c)} last week`} />
        <StatTile label="Subscribers" value={cell.n_subs.toLocaleString("en-US")} sub={`CPL ${cell.n_subs > 0 ? usd(cell.cpl_c) : "—"} · CAC ${cell.cac_c > 0 ? usd(cell.cac_c) : "—"}`} />
        <StatTile
          label="Revenue to date"
          value={usd(cell.realized_rev_c, { compact: true })}
          sub={`front-end ${usd(cell.fe_rev_c, { compact: true })} · back-end ${usd(cell.be_rev_c, { compact: true })}`}
        />
        <StatTile
          label="Payback"
          value={cell.payback_day !== null ? `day ${cell.payback_day}` : "not yet"}
          sub={`maturity ${pct(cell.maturity_frac)} · confidence ${pct(cell.confidence)}`}
        />
      </section>

      {/* Payback curve — hand-rolled SVG (Recharts upgrade lands with M3) */}
      {series && series.n > 0 && (
        <section className="rounded-xl border border-line bg-surface p-5">
          <div className="text-[11px] uppercase tracking-wider text-faint mb-3">
            Cumulative revenue per subscriber vs cost per subscriber (day 0–90)
          </div>
          <PaybackSvg cum={series.cum_rev_per_sub_c} cac={series.cac_c} />
        </section>
      )}

      {/* Decomposition (per-trait effects) */}
      {effects_for_dims.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-5">
          <div className="text-[11px] uppercase tracking-wider text-faint mb-3">
            What each trait adds or subtracts (portfolio-wide decomposition, buyers)
          </div>
          <div className="space-y-2">
            {effects_for_dims
              .sort((a, b) => Math.abs(b.effect_value_usd) - Math.abs(a.effect_value_usd))
              .map((e) => (
                <div key={`${e.dim}=${e.level}`} className="flex items-center gap-3 text-sm">
                  <span className="w-56 text-muted truncate">
                    {e.dim}: <span className="text-foreground">{e.level}</span>
                  </span>
                  <div className="grow h-3 relative">
                    <div className="absolute inset-y-0 left-1/2 w-px bg-line" />
                    <div
                      className={`absolute inset-y-0 ${e.effect_value_usd >= 0 ? "left-1/2 bg-scale/70" : "right-1/2 bg-kill/70"} rounded-sm`}
                      style={{ width: `${Math.min(48, Math.abs(e.effect_value_usd) * 1.2)}%` }}
                    />
                  </div>
                  <span className={`w-20 text-right tabular-nums ${e.effect_value_usd >= 0 ? "text-scale" : "text-kill"}`}>
                    {e.effect_value_usd >= 0 ? "+" : "−"}${Math.abs(e.effect_value_usd).toFixed(0)}
                  </span>
                </div>
              ))}
          </div>
          <p className="text-[11px] text-faint mt-3">
            One number per trait, holding the others steady — from a regression over matured cohorts,
            not this cell alone. Click-through pivots land with M3.
          </p>
        </section>
      )}

      {/* Children */}
      {children_preview.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted">Inside this cell</h2>
          <div className="rounded-xl border border-line overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {children_preview.map((c) => (
                  <tr key={c.cell_key} className="border-b border-line/50 last:border-0 hover:bg-raised/60">
                    <td className="px-3 py-2">
                      <Link href={`/cell/${c.cell_key}`} className="hover:underline underline-offset-4">
                        {cellPath(c.dims)}
                      </Link>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <VerdictBadge verdict={c.verdict} isFlip={c.is_flip} />
                    </td>
                    <td className="px-3 py-2 text-right text-muted whitespace-nowrap">{usd(c.spend_c, { compact: true })}</td>
                    <td className={`px-3 py-2 text-right font-medium whitespace-nowrap ${c.ltv_shrunk >= 1 ? "text-scale" : "text-kill"}`}>
                      {mult(c.ltv_shrunk)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function PaybackSvg({ cum, cac }: { cum: number[]; cac: number }) {
  const w = 720;
  const h = 180;
  const pad = { l: 44, r: 12, t: 10, b: 22 };
  const maxY = Math.max(cac * 1.4, ...cum) || 1;
  const x = (i: number) => pad.l + (i / (cum.length - 1)) * (w - pad.l - pad.r);
  const y = (v: number) => h - pad.b - (v / maxY) * (h - pad.t - pad.b);
  const points = cum.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const crossIdx = cum.findIndex((v) => v >= cac);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" role="img" aria-label="Payback curve">
      {/* CAC reference line */}
      <line x1={pad.l} x2={w - pad.r} y1={y(cac)} y2={y(cac)} stroke="var(--kill)" strokeDasharray="4 4" strokeOpacity={0.7} />
      <text x={w - pad.r} y={y(cac) - 5} textAnchor="end" fontSize={10} fill="var(--kill)">
        cost per subscriber {`$${Math.round(cac / 100)}`}
      </text>
      {/* revenue curve */}
      <polyline points={points} fill="none" stroke="var(--scale)" strokeWidth={2} />
      {crossIdx > 0 && (
        <>
          <circle cx={x(crossIdx)} cy={y(cum[crossIdx])} r={4} fill="var(--scale)" />
          <text x={x(crossIdx)} y={y(cum[crossIdx]) - 8} textAnchor="middle" fontSize={10} fill="var(--scale)">
            payback
          </text>
        </>
      )}
      {/* axis labels */}
      {[0, 30, 60, 90].map((d) => (
        <text key={d} x={x(Math.round((d / 90) * (cum.length - 1)))} y={h - 6} textAnchor="middle" fontSize={10} fill="var(--faint)">
          d{d}
        </text>
      ))}
      <text x={pad.l - 6} y={y(0)} textAnchor="end" fontSize={10} fill="var(--faint)">
        $0
      </text>
      <text x={pad.l - 6} y={y(maxY) + 8} textAnchor="end" fontSize={10} fill="var(--faint)">
        {`$${Math.round(maxY / 100)}`}
      </text>
    </svg>
  );
}
