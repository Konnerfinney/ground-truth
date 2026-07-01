import { NextResponse } from "next/server";
import { getCell } from "@/engine/query";
import { loadArtifacts } from "@/lib/artifacts";

export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const data = await loadArtifacts();
  const detail = getCell(data, key);
  if (!detail) {
    return NextResponse.json(
      {
        error: "cell_not_found",
        requested: key,
        note: "Cell keys are content-addressed and survive regeneration; this key matches no materialized cell.",
        try: {
          flip_cell: data.meta.flip_cell_key,
          untapped_cell: data.meta.untapped_cell_key,
        },
      },
      { status: 404 },
    );
  }
  return NextResponse.json(detail);
}
