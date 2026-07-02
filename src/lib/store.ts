import { memoryStore, type GroundTruthStore } from "@/engine/store";
import { loadArtifacts } from "./artifacts";

/**
 * Store selection. Default (and the deployed demo): the in-memory artifact
 * store — zero services, nothing to die during judging. Set DATABASE_URL to
 * serve the identical contract from Postgres instead; the parity suite
 * guarantees the two backends return the same rows.
 */

let cached: Promise<GroundTruthStore> | null = null;

async function build(): Promise<GroundTruthStore> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const [{ default: postgres }, { pgStore }] = await Promise.all([
      import("postgres"),
      import("./pg/pgstore"),
    ]);
    // prepare:false → compatible with transaction-mode poolers (Supabase
    // Supavisor, pgBouncer), which don't support prepared statements.
    const sql = postgres(url, { max: 5, prepare: false });
    return pgStore(async (text, params = []) => ({
      rows: (await sql.unsafe(text, params as never[])) as unknown as Record<string, unknown>[],
    }));
  }
  return memoryStore(await loadArtifacts());
}

export function getStore(): Promise<GroundTruthStore> {
  cached ??= build();
  return cached;
}
