import {
  dailyBrief,
  drillDown,
  findUntapped,
  getCell,
  listFlips,
  queryCells,
  type CellDetail,
  type QueryData,
} from "./query";
import type { BriefArtifact, CellQuery, CubeRow, MetaArtifact } from "./types";

/**
 * The storage seam (README "Production path"). Exactly one interface reads
 * Ground Truth data; the demo default is the in-memory artifact store, and
 * src/lib/pg/ implements the same interface against Postgres. The parity
 * suite in tests/pgstore.test.ts asserts both backends return identical rows
 * — the "only the producer changes" claim as a passing test, not a promise.
 */
export interface GroundTruthStore {
  queryCells(
    q: Partial<CellQuery> & { grain: CellQuery["grain"] },
  ): Promise<{ rows: CubeRow[]; applied: CellQuery }>;
  getCell(key: string): Promise<CellDetail | null>;
  drillDown(key: string): Promise<CubeRow[]>;
  dailyBrief(): Promise<BriefArtifact>;
  listFlips(minImpact_c?: number): Promise<CubeRow[]>;
  findUntapped(): Promise<CubeRow[]>;
  meta(): Promise<MetaArtifact>;
}

/** The demo default: pure functions over the baked JSON artifacts. */
export function memoryStore(data: QueryData): GroundTruthStore {
  return {
    queryCells: async (q) => queryCells(data, q),
    getCell: async (key) => getCell(data, key),
    drillDown: async (key) => drillDown(data, key),
    dailyBrief: async () => dailyBrief(data),
    listFlips: async (minImpact_c = 0) => listFlips(data, minImpact_c),
    findUntapped: async () => findUntapped(data),
    meta: async () => data.meta,
  };
}
