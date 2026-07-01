import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DIM_NAMES, type DimName } from "@/engine/dims";
import { availableGrains, queryCells } from "@/engine/query";
import { GrainNotAvailable } from "@/engine/types";
import { loadArtifacts } from "@/lib/artifacts";

const paramsSchema = z.object({
  grain: z.string().min(1),
  metric: z
    .enum(["ltv_per_dollar", "ltv_raw", "spend", "platform_roas", "flip_divergence", "dollar_impact"])
    .optional(),
  min_confidence: z.coerce.number().min(0).max(1).optional(),
  hurdle: z.coerce.number().min(0).optional(),
  order: z.enum(["desc", "asc"]).optional(),
  top_n: z.coerce.number().int().min(1).max(500).optional(),
});

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const parsed = paramsSchema.safeParse(Object.fromEntries(sp.entries()));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_params", detail: parsed.error.issues },
      { status: 400 },
    );
  }
  // filters: f_<dim>=value or filters[<dim>]=value
  const filters: Partial<Record<DimName, string>> = {};
  for (const dim of DIM_NAMES) {
    const v = sp.get(`f_${dim}`) ?? sp.get(`filters[${dim}]`);
    if (v) filters[dim] = v;
  }

  const grain = parsed.data.grain.includes(",")
    ? (parsed.data.grain.split(",") as DimName[])
    : parsed.data.grain;

  try {
    const data = await loadArtifacts();
    const result = queryCells(data, { ...parsed.data, grain, filters });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof GrainNotAvailable) {
      return NextResponse.json(
        {
          error: "grain_not_available",
          requested: e.requested,
          available_grains: e.available_grains,
          note: "Per-dimension effects outside these grains are available via explain_cell / dim_effects (decomposition).",
        },
        { status: 400 },
      );
    }
    throw e;
  }
}
