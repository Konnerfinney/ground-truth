import { afterEach, describe, expect, it } from "vitest";
import { csvToSpendRows, parseCsv } from "@/connectors/csv";
import {
  insightsUrl,
  mapDevice,
  mapPlacement,
  metaAdapter,
  parseInsightsPage,
  stripToken,
  type MetaInsightsResponse,
} from "@/connectors/meta";
import { parseName, parseNameHierarchy } from "@/connectors/naming";
import { configuredAdapters, connectorStatuses } from "@/connectors/registry";

describe("naming-convention parser", () => {
  it("parses tokens in any order, case and separator", () => {
    expect(parseName("Q3 Inflation | aud:retirement | ang:education | off:core-99")).toEqual({
      audience: "retirement",
      creative: "education",
      offer: "core-99",
    });
    expect(parseName("AUD=Crypto-Curious ANG=hype-10x")).toEqual({
      audience: "crypto-curious",
      creative: "hype-10x",
      offer: null,
    });
  });

  it("most specific name wins: ad > adset > campaign", () => {
    const parsed = parseNameHierarchy(
      "brand | aud:broad | off:tw7",
      "aud:retirement",
      "ang:education",
    );
    expect(parsed).toEqual({ audience: "retirement", creative: "education", offer: "tw7" });
  });

  it("untagged names yield nulls, never throws", () => {
    expect(parseName("Summer Sale 2026!!")).toEqual({ audience: null, creative: null, offer: null });
  });
});

describe("meta adapter", () => {
  const FIXTURE: MetaInsightsResponse = {
    data: [
      {
        date_start: "2026-07-01",
        account_id: "1234567890",
        campaign_id: "c1",
        campaign_name: "Q3 | aud:crypto-curious | off:tw7",
        adset_id: "s1",
        adset_name: "LAL 3% | ang:hype-10x",
        ad_id: "a1",
        ad_name: "vid dollar collapse v3",
        spend: "1234.56",
        impressions: "10000",
        clicks: "250",
        publisher_platform: "instagram",
        platform_position: "instagram_reels",
        device_platform: "mobile_app",
      },
      {
        date_start: "2026-07-01",
        account_id: "1234567890",
        campaign_id: "c2",
        campaign_name: "Retirement | aud:retirement | ang:education | off:core-99",
        adset_id: "s2",
        adset_name: "interest stack",
        ad_id: "a2",
        ad_name: "longform essay",
        spend: "89.10",
        impressions: "1200",
        clicks: "40",
        publisher_platform: "facebook",
        platform_position: "feed",
        device_platform: "desktop",
      },
    ],
  };

  it("parses a v25 insights page into normalized rows (cents, vocab, names)", () => {
    const rows = parseInsightsPage(FIXTURE);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      platform: "meta",
      date: "2026-07-01",
      placement: "reels",
      device: "mobile",
      geo: "all",
      spend_c: 123456,
      impressions: 10000,
      clicks: 250,
      audience: "crypto-curious",
      creative: "hype-10x",
      offer: "tw7",
    });
    expect(rows[1]).toMatchObject({ placement: "fb-feed", device: "desktop", spend_c: 8910, creative: "education" });
  });

  it("maps placements and devices into our vocabulary", () => {
    expect(mapPlacement("facebook", "facebook_reels")).toBe("reels");
    expect(mapPlacement("instagram", "instagram_stories")).toBe("stories");
    expect(mapPlacement("audience_network", "classic")).toBe("audience-network");
    expect(mapPlacement(undefined, undefined)).toBe("all");
    expect(mapDevice("mobile_app")).toBe("mobile");
    expect(mapDevice(undefined)).toBe("all");
  });

  it("builds a v25 ad-level insights URL — token NEVER in the URL", () => {
    const url = insightsUrl({ accessToken: "tkn-secret", adAccountId: "42" }, "2026-07-01");
    expect(url).toContain("graph.facebook.com/v25.0/act_42/insights");
    expect(url).toContain("level=ad");
    expect(decodeURIComponent(url)).toContain("publisher_platform,platform_position,device_platform");
    expect(url).not.toContain("tkn-secret");
    expect(url).not.toContain("access_token");
  });

  it("strips tokens Meta echoes into paging.next", () => {
    expect(stripToken("https://graph.facebook.com/v25.0/act_1/insights?after=abc&access_token=LEAK")).toBe(
      "https://graph.facebook.com/v25.0/act_1/insights?after=abc",
    );
  });

  it("follows pagination with header auth on every request, surfaces API errors", async () => {
    const page2: MetaInsightsResponse = { data: [FIXTURE.data[1]] };
    const page1: MetaInsightsResponse = {
      data: [FIXTURE.data[0]],
      paging: { next: "https://next.page/?after=x&access_token=LEAK" },
    };
    const calls: { url: string; auth: string | undefined }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), auth: (init?.headers as Record<string, string>)?.Authorization });
      const body = calls.length === 1 ? page1 : page2;
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;

    const rows = await metaAdapter({ accessToken: "t", adAccountId: "act_9" }, fakeFetch).fetchSpend("2026-07-01");
    expect(rows).toHaveLength(2);
    expect(calls[1].url).toBe("https://next.page/?after=x");
    expect(calls.every((c) => c.auth === "Bearer t")).toBe(true);
    expect(calls.every((c) => !c.url.includes("access_token"))).toBe(true);

    const errFetch = (async () => new Response('{"error":{"message":"(#190) token expired"}}', { status: 400 })) as unknown as typeof fetch;
    const err = await metaAdapter({ accessToken: "t", adAccountId: "9" }, errFetch)
      .fetchSpend("2026-07-01")
      .catch((e: Error) => e.message);
    expect(err).toContain("meta insights 400");
    expect(err).toContain("token expired");
  });
});

describe("csv adapter", () => {
  it("round-trips quoted fields and applies the naming convention", () => {
    const text = [
      "date,campaign,adset,ad,spend,impressions,clicks,placement",
      '2026-07-01,"Native, Q3 | aud:gold-bugs | off:premium-199",widgets,"ad ""A""",100.50,5000,120,native-widget',
    ].join("\n");
    const rows = csvToSpendRows(text, { platform: "taboola" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      platform: "taboola",
      spend_c: 10050,
      placement: "native-widget",
      audience: "gold-bugs",
      offer: "premium-199",
      ad_name: 'ad "A"',
    });
  });

  it("rejects exports missing required columns", () => {
    expect(() => csvToSpendRows("date,spend\n2026-07-01,5", { platform: "x" })).toThrow(/missing required column/);
  });

  it("parseCsv handles CRLF and embedded newlines", () => {
    expect(parseCsv('a,b\r\n"x\ny",2\r\n')).toEqual([
      ["a", "b"],
      ["x\ny", "2"],
    ]);
  });
});

describe("registry (env-driven)", () => {
  const saved = { tok: process.env.META_ACCESS_TOKEN, acct: process.env.META_AD_ACCOUNT_ID };
  afterEach(() => {
    if (saved.tok === undefined) delete process.env.META_ACCESS_TOKEN;
    else process.env.META_ACCESS_TOKEN = saved.tok;
    if (saved.acct === undefined) delete process.env.META_AD_ACCOUNT_ID;
    else process.env.META_AD_ACCOUNT_ID = saved.acct;
  });

  it("reports awaiting-credentials without env, configured with it", () => {
    delete process.env.META_ACCESS_TOKEN;
    delete process.env.META_AD_ACCOUNT_ID;
    let meta = connectorStatuses().find((s) => s.platform === "meta")!;
    expect(meta.kind === "api" && meta.configured).toBe(false);
    expect(configuredAdapters()).toHaveLength(0);

    process.env.META_ACCESS_TOKEN = "tkn";
    process.env.META_AD_ACCOUNT_ID = "act_1";
    meta = connectorStatuses().find((s) => s.platform === "meta")!;
    expect(meta.kind === "api" && meta.configured).toBe(true);
    expect(configuredAdapters().map((a) => a.platform)).toEqual(["meta"]);
  });

  it("never exposes secret VALUES, only variable names", () => {
    process.env.META_ACCESS_TOKEN = "super-secret-token";
    const json = JSON.stringify(connectorStatuses());
    expect(json).not.toContain("super-secret-token");
  });
});
