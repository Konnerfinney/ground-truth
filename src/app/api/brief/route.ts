import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";

export async function GET() {
  const store = await getStore();
  const [brief, meta] = await Promise.all([store.dailyBrief(), store.meta()]);
  return NextResponse.json({
    ...brief,
    snapshot_meta: {
      snapshot_at: meta.snapshot_at,
      seed: meta.seed,
      source: meta.source,
    },
  });
}
