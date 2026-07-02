import { ProposalList } from "@/components/cart/CartClient";

export const dynamic = "force-static";

export default function ProposalPage() {
  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-xl font-semibold">Proposal cart</h1>
      <p className="text-sm text-muted max-w-2xl">
        Staged budget moves, drafted from verdicts. Export as CSV or Slack text — a human reviews
        and applies them. Ground Truth is read-only by design.
      </p>
      <ProposalList />
    </div>
  );
}
