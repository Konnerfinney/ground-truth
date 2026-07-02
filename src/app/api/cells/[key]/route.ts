import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";

export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const store = await getStore();
  const detail = await store.getCell(key);
  if (!detail) {
    const meta = await store.meta();
    return NextResponse.json(
      {
        error: "cell_not_found",
        requested: key,
        note: "Cell keys are content-addressed and survive regeneration; this key matches no materialized cell.",
        try: {
          flip_cell: meta.flip_cell_key,
          untapped_cell: meta.untapped_cell_key,
        },
      },
      { status: 404 },
    );
  }
  return NextResponse.json(detail);
}
