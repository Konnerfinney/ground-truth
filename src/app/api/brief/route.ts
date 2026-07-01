import { NextResponse } from "next/server";
import { dailyBrief } from "@/engine/query";
import { loadArtifacts } from "@/lib/artifacts";

export async function GET() {
  const data = await loadArtifacts();
  const brief = dailyBrief(data);
  return NextResponse.json({
    ...brief,
    snapshot_meta: {
      snapshot_at: data.meta.snapshot_at,
      seed: data.meta.seed,
      source: data.meta.source,
      cube_rows: data.rows.length,
    },
  });
}
