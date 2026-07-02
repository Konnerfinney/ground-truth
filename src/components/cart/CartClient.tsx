"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

/**
 * Proposal cart — the ONLY client island in the app. Staged budget moves live
 * in localStorage; output is a CSV download + copy-to-Slack text. Read-only
 * mandate: this never talks to any ad platform, it drafts.
 */

export type CartAction = "pause" | "decrease" | "increase" | "test";

export interface CartItem {
  cell_key: string;
  path: string;
  verdict: string;
  action: CartAction;
  delta_pct: number | null;
  spend_day_usd: number;
  impact_day_usd: number;
}

const KEY = "gt-proposal-v1";
const EVT = "gt-cart-change";

function read(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as CartItem[];
  } catch {
    return [];
  }
}

function write(items: CartItem[]) {
  window.localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new Event(EVT));
}

function useCart(): [CartItem[], (items: CartItem[]) => void] {
  const [items, setItems] = useState<CartItem[]>([]);
  useEffect(() => {
    const sync = () => setItems(read());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return [items, write];
}

export function CartBadge() {
  const [items] = useCart();
  if (items.length === 0)
    return (
      <Link href="/proposal" className="text-[11px] text-faint hover:text-foreground whitespace-nowrap">
        proposal: empty
      </Link>
    );
  const net = items.reduce((a, i) => a + i.impact_day_usd, 0);
  return (
    <Link
      href="/proposal"
      className="text-[11px] px-2.5 py-1 rounded-full border border-scale/40 text-scale bg-scale/10 hover:bg-scale/20 whitespace-nowrap"
    >
      proposal: {items.length} move{items.length > 1 ? "s" : ""} · ~${Math.round(net).toLocaleString("en-US")}/day
    </Link>
  );
}

export function AddToProposal({ item }: { item: CartItem }) {
  const [items, setItems] = useCart();
  const staged = items.some((i) => i.cell_key === item.cell_key);
  const toggle = useCallback(() => {
    setItems(staged ? items.filter((i) => i.cell_key !== item.cell_key) : [...items, item]);
  }, [staged, items, item, setItems]);
  return (
    <button
      onClick={toggle}
      className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${
        staged
          ? "border-scale/50 text-scale bg-scale/10"
          : "border-line text-muted hover:text-foreground hover:border-faint"
      }`}
      title="Stages a reversible draft — nothing is executed, nothing touches an ad platform."
    >
      {staged ? "✓ staged" : `+ ${labelFor(item.action, item.delta_pct)}`}
    </button>
  );
}

function labelFor(action: CartAction, delta: number | null): string {
  switch (action) {
    case "pause":
      return "draft pause";
    case "decrease":
      return `draft −${Math.abs(delta ?? 30)}%`;
    case "increase":
      return `draft +${delta ?? 30}%`;
    case "test":
      return "draft test budget";
  }
}

export function ProposalList() {
  const [items, setItems] = useCart();
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted">
        Nothing staged yet. Add moves from the{" "}
        <Link href="/brief" className="underline underline-offset-4">
          Morning Brief
        </Link>{" "}
        or any cell page — each is a reversible draft, never an execution.
      </p>
    );
  }
  const bleedStopped = items.filter((i) => i.action === "pause" || i.action === "decrease");
  const net = items.reduce((a, i) => a + i.impact_day_usd, 0);

  const csv = [
    "cell_key,cell,action,delta_pct,current_spend_per_day_usd,projected_impact_per_day_usd,verdict",
    ...items.map(
      (i) =>
        `${i.cell_key},"${i.path}",${i.action},${i.delta_pct ?? ""},${i.spend_day_usd},${i.impact_day_usd},${i.verdict}`,
    ),
  ].join("\n");

  const slack = [
    `*Ground Truth proposal — ${items.length} move${items.length > 1 ? "s" : ""}, ~$${Math.round(net).toLocaleString("en-US")}/day projected*`,
    ...items.map(
      (i) =>
        `• ${i.action.toUpperCase()}${i.delta_pct ? ` ${i.delta_pct > 0 ? "+" : ""}${i.delta_pct}%` : ""} — ${i.path} (${i.verdict}, ~$${i.spend_day_usd}/day now, ~$${i.impact_day_usd}/day impact)`,
    ),
    "_Drafted from 90-day profit truth; verdicts gate on uncertainty ranges. Reversible; nothing executed._",
  ].join("\n");

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-line overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface text-left text-xs text-muted">
              <th className="px-3 py-2">Cell</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2 text-right">Spend/day</th>
              <th className="px-3 py-2 text-right">Projected impact/day</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.cell_key} className="border-t border-line/50">
                <td className="px-3 py-2">
                  <Link href={`/cell/${i.cell_key}`} className="hover:underline underline-offset-4">
                    {i.path}
                  </Link>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-muted">
                  {i.action}
                  {i.delta_pct ? ` ${i.delta_pct > 0 ? "+" : ""}${i.delta_pct}%` : ""}
                </td>
                <td className="px-3 py-2 text-right text-muted">${i.spend_day_usd.toLocaleString("en-US")}</td>
                <td className={`px-3 py-2 text-right ${i.impact_day_usd >= 0 ? "text-scale" : "text-kill"}`}>
                  ~${i.impact_day_usd.toLocaleString("en-US")}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => setItems(items.filter((x) => x.cell_key !== i.cell_key))}
                    className="text-faint hover:text-kill text-xs"
                  >
                    remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm">
          Net projected: <span className={`font-display text-lg ${net >= 0 ? "text-scale" : "text-kill"}`}>~${Math.round(net).toLocaleString("en-US")}/day</span>
          <span className="text-faint text-xs ml-2">({bleedStopped.length} bleed-stoppers; upside is a naive marginal estimate)</span>
        </span>
        <span className="ml-auto flex gap-2">
          <button
            onClick={() => {
              const blob = new Blob([csv], { type: "text/csv" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "ground-truth-proposal.csv";
              a.click();
              URL.revokeObjectURL(a.href);
            }}
            className="text-xs px-3 py-1.5 rounded-md border border-line hover:border-faint"
          >
            Download CSV
          </button>
          <button
            onClick={() => navigator.clipboard.writeText(slack)}
            className="text-xs px-3 py-1.5 rounded-md border border-line hover:border-faint"
          >
            Copy for Slack
          </button>
          <button
            onClick={() => setItems([])}
            className="text-xs px-3 py-1.5 rounded-md border border-line text-faint hover:text-kill hover:border-kill/40"
          >
            Clear
          </button>
        </span>
      </div>

      <p className="text-[11px] text-faint">
        This proposal is a draft artifact — reversible, auditable, and never pushed to any ad
        platform. The production path executes behind caps, confirmation, rollback and an audit
        log, through the ad workflow you already run.
      </p>
    </div>
  );
}
