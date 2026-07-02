import postgres from "postgres";
import { loadArtifacts } from "../src/lib/artifacts";
import { loadIntoPg } from "../src/lib/pg/pgstore";

/**
 * Load the current artifacts into a Postgres database with an atomic
 * staging-schema swap — the demo edition of the nightly snapshot job.
 *
 *   DATABASE_URL=postgres://... npm run db:load
 */

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required (e.g. a Neon/Supabase/local connection string).");
  process.exit(1);
}

// max:1 keeps the staging-schema search_path on one session; prepare:false
// works through transaction-mode poolers (Supabase Supavisor, pgBouncer).
const sql = postgres(url, { max: 1, prepare: false });
const t0 = performance.now();

const exec = async (text: string, params: unknown[] = []) => ({
  rows: (await sql.unsafe(text, params as never[])) as unknown as Record<string, unknown>[],
});

const data = await loadArtifacts();
await loadIntoPg(exec, data);

console.log(
  `loaded ${data.rows.length} cube rows, ${data.brief.cards.length} brief cards, ${data.series.size} series, ${data.effects.length} effects in ${((performance.now() - t0) / 1000).toFixed(1)}s`,
);
console.log("serve from it with: DATABASE_URL=... npm run dev");
await sql.end();
