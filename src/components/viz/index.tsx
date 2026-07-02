import type { CubeRow, Verdict } from "@/engine/types";
import { mult, pct, usd } from "@/lib/format";

/** Hand-rolled micro-viz (SPEC §10): zero client JS, judging-day-proof. */

const VERDICT_STYLE: Record<Verdict, string> = {
  SCALE: "text-scale border-scale/40 bg-scale/10",
  KILL: "text-kill border-kill/40 bg-kill/10",
  TRIM: "text-trim border-trim/40 bg-trim/10",
  WATCH: "text-watch border-watch/40 bg-watch/10",
  UNTAPPED: "text-untapped border-untapped/40 bg-untapped/10",
};

export function VerdictBadge({
  verdict,
  leaning,
  isFlip,
}: {
  verdict: Verdict;
  leaning?: Verdict | null;
  isFlip?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`text-[11px] font-semibold tracking-wide px-2 py-0.5 rounded border ${VERDICT_STYLE[verdict]}`}
      >
        {verdict}
      </span>
      {isFlip && (
        <span
          className="text-flip text-xs"
          title="THE FLIP: the platform reports this cell as a winner; true 90-day payback says it loses money."
        >
          ◆ FLIP
        </span>
      )}
      {leaning && (
        <span className="text-[11px] text-faint" title="Not enough evidence to act yet — this is where the data points so far.">
          leaning {leaning}
        </span>
      )}
    </span>
  );
}

/**
 * The hero metric: true LTV:CAC as a bullet bar with an 80% uncertainty
 * whisker against 1×/2×/3× reference ticks. Buyers think in multiples.
 */
export function BulletBar({
  value,
  lo,
  hi,
  verdict,
  max = 3.5,
}: {
  value: number;
  lo: number;
  hi: number;
  verdict: Verdict;
  max?: number;
}) {
  const x = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  const barColor =
    verdict === "KILL" ? "bg-kill" : verdict === "TRIM" ? "bg-trim" : verdict === "UNTAPPED" ? "bg-untapped" : verdict === "WATCH" ? "bg-watch" : "bg-scale";
  return (
    <div className="w-full">
      <div className="relative h-5">
        {/* track */}
        <div className="absolute inset-y-1.5 inset-x-0 rounded-sm bg-raised" />
        {/* reference ticks at 1x / 2x / 3x */}
        {[1, 2, 3].map((t) => (
          <div
            key={t}
            className={`absolute top-0 bottom-0 w-px ${t === 1 ? "bg-foreground/50" : "bg-line"}`}
            style={{ left: x(t) }}
          />
        ))}
        {/* value bar */}
        <div
          className={`absolute inset-y-1.5 left-0 rounded-sm ${barColor} opacity-80`}
          style={{ width: x(value) }}
        />
        {/* uncertainty whisker */}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-px bg-foreground/70"
          style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})` }}
        />
        <div className="absolute top-1/2 -translate-y-1/2 h-2.5 w-px bg-foreground/70" style={{ left: x(lo) }} />
        <div className="absolute top-1/2 -translate-y-1/2 h-2.5 w-px bg-foreground/70" style={{ left: x(hi) }} />
      </div>
      <div className="flex justify-between text-[10px] text-faint mt-0.5">
        <span>0×</span>
        <span className="text-muted">break-even 1×</span>
        <span>2×</span>
        <span>3×+</span>
      </div>
    </div>
  );
}

/**
 * Platform-vs-truth dumbbell: what the pixel claims vs what the 90-day back
 * end pays. The gap IS the product. Platform ROAS is never shown alone.
 */
export function Dumbbell({ platformRoas, truth, max = 3.5 }: { platformRoas: number; truth: number; max?: number }) {
  const w = 220;
  const h = 26;
  const x = (v: number) => 26 + Math.min(1, Math.max(0, v / max)) * (w - 52);
  const y = h / 2;
  const diverges = platformRoas > truth;
  return (
    <svg width={w} height={h} className="shrink-0" role="img" aria-label={`Platform claims ${mult(platformRoas)}, truth ${mult(truth)}`}>
      <line x1={x(1)} y1={2} x2={x(1)} y2={h - 2} stroke="var(--line)" strokeDasharray="2 3" />
      <line
        x1={x(platformRoas)}
        y1={y}
        x2={x(truth)}
        y2={y}
        stroke={diverges ? "var(--kill)" : "var(--scale)"}
        strokeOpacity={0.5}
        strokeWidth={2}
      />
      <circle cx={x(platformRoas)} cy={y} r={4.5} fill="var(--faint)" />
      <circle cx={x(truth)} cy={y} r={5} fill={truth >= 1 ? "var(--scale)" : "var(--kill)"} />
      <text x={x(platformRoas)} y={y - 8} textAnchor="middle" fontSize={9} fill="var(--faint)">
        pixel {mult(platformRoas, 1)}
      </text>
      <text x={x(truth)} y={y + 13} textAnchor="middle" fontSize={9} fill={truth >= 1 ? "var(--scale)" : "var(--kill)"}>
        true {mult(truth, 1)}
      </text>
    </svg>
  );
}

/** "n=412 · 38d observed · 18% borrowed" — evidence provenance at a glance. */
export function MaturityBadge({ row }: { row: CubeRow }) {
  return (
    <span
      className="text-[11px] text-faint whitespace-nowrap"
      title="Subscribers observed · how much of the 90-day window has elapsed · how much of the estimate is borrowed from the parent cell"
    >
      n={row.n_subs.toLocaleString("en-US")} · {Math.round(row.maturity_frac * 90)}d ·{" "}
      {pct(row.shrink_weight)} borrowed
    </span>
  );
}

export function StatTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "kill" | "scale" | "untapped";
}) {
  const toneClass = tone === "kill" ? "text-kill" : tone === "scale" ? "text-scale" : tone === "untapped" ? "text-untapped" : "";
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-faint">{label}</div>
      <div className={`text-xl font-semibold mt-0.5 ${toneClass}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

export function ImpactMoney({ cents, kind }: { cents: number; kind: "bleed" | "upside" }) {
  return (
    <span className={`font-display text-lg ${kind === "bleed" ? "text-kill" : "text-scale"}`}>
      {kind === "bleed" ? "−" : "+"}
      {usd(cents)}/day
    </span>
  );
}
