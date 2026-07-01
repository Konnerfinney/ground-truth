import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

/**
 * Ground Truth MCP server — read-only tools over the same query contract the
 * UI uses. Streamable HTTP only (stateless): no SSE, no Redis, no env vars.
 *
 * Day-0 spike: `ping` proves the transport end-to-end on Vercel before the
 * engine exists. Real tools (rank_cells, get_cell, explain_cell, list_flips,
 * find_untapped, daily_brief, draft_budget_change) land in M3.
 */
const handler = createMcpHandler(
  (server) => {
    server.tool(
      "ping",
      "Health check for the Ground Truth MCP server. Returns pong plus server info.",
      { echo: z.string().optional().describe("Optional string to echo back") },
      async ({ echo }) => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              pong: true,
              server: "ground-truth",
              data: "synthetic-demo",
              echo: echo ?? null,
            }),
          },
        ],
      }),
    );
  },
  {
    serverInfo: { name: "ground-truth", version: "0.1.0" },
  },
  {
    basePath: "/api",
    verboseLogs: false,
    maxDuration: 60,
  },
);

export { handler as GET, handler as POST, handler as DELETE };
