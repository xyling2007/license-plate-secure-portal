import { Client } from "@notionhq/client";
import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

// NOTE: Do NOT construct the Notion client at module scope (top-level).
// On Cloudflare Workers, @opennextjs/cloudflare only copies your Worker's
// env vars/secrets into `process.env` *inside* the per-request handler
// (see node_modules/@opennextjs/aws/dist/overrides/wrappers/cloudflare-node.js).
// Module-level code runs once at cold start, *before* that copy happens, so
// `process.env.NOTION_API_KEY` would still be `undefined` here — this is
// exactly why it worked in local Next.js dev (where process.env is populated
// before any module import) but failed as a deployed Worker. Reading it
// inside the request handler below reads it after it's been populated.
function getNotionClient() {
  return new Client({ auth: process.env.NOTION_API_KEY });
}

// Simple in-memory cache for the data source id + "車款" select options, so
// most requests skip straight to the actual search query instead of paying
// for `databases.retrieve` + `dataSources.retrieve` on every single search.
// This is safe as module-level *mutable state*, unlike `process.env` above —
// there's no cold-start timing issue here since we only ever read/write
// `schemaCache` from inside the request handler, well after the module has
// finished loading. Worst case if this staleness bites: a car model renamed
// or added in Notion in the last few minutes won't be searchable until the
// cache expires — acceptable for how rarely that changes.
//
// Scope note: each Cloudflare Workers isolate gets its own copy of this
// variable (it is NOT a shared/distributed cache across edge locations),
// and an idle isolate can be evicted at any time — so this only ever saves
// calls *within* a single warm isolate's lifetime. It also can't leak
// memory: it's one small, bounded object that gets replaced wholesale on
// every refresh, never appended to.
const SCHEMA_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
let schemaCache = null; // { dataSourceId, carModelOptions, fetchedAt }

export async function POST(request) {
  try {
    // This endpoint is public with no login, so throttle per-IP to slow
    // down anyone scripting through plate/owner/model guesses.
    const { env } = getCloudflareContext();
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    const { success } = await env.SEARCH_RATE_LIMITER.limit({ key: ip });
    if (!success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const { query } = await request.json();
    const search = (query || "").toString().trim();

    // No query, no results — never dump the full table to the client.
    if (!search) {
      return NextResponse.json([]);
    }

    const notionApiKey = process.env.NOTION_API_KEY;
    const notionDatabaseId = process.env.NOTION_DATABASE_ID;

    if (!notionApiKey || !notionDatabaseId) {
      // Log the specific cause server-side only — never leak config details
      // to the client response.
      console.error(
        "Missing Notion config at runtime:",
        !notionApiKey ? "NOTION_API_KEY" : "",
        !notionDatabaseId ? "NOTION_DATABASE_ID" : "",
        "— check Settings > Variables and Secrets on the Worker (not just the build-time variables)."
      );
      return NextResponse.json({ error: "Search failed" }, { status: 500 });
    }

    const notion = getNotionClient();

    let dataSourceId;
    let carModelOptions;
    const cacheIsFresh =
      schemaCache && Date.now() - schemaCache.fetchedAt < SCHEMA_CACHE_TTL_MS;

    if (cacheIsFresh) {
      ({ dataSourceId, carModelOptions } = schemaCache);
    } else {
      // Resolve the data source id for this database (Notion API 2025-09-03+).
      const db = await notion.databases.retrieve({
        database_id: notionDatabaseId,
      });
      dataSourceId = db.data_sources?.[0]?.id;
      if (!dataSourceId) {
        throw new Error(
          "Notion database has no data sources — check NOTION_DATABASE_ID"
        );
      }

      // "車款" is a Notion `select` property. Critically, Notion's API
      // rejects the ENTIRE query with a 400 validation_error if a
      // `select.equals` filter value isn't one of that property's defined
      // options — it does NOT just treat it as "no match" for that clause
      // and move on. (This is exactly what was causing every search for a
      // plate number, e.g. "alm-8077", to fail: it isn't a valid "車款"
      // option, so Notion rejected the whole OR filter, 車牌/登記人 clauses
      // included.) So we look up the real option list first and only add
      // the 車款 clause when `search` actually matches one of them.
      const dataSource = await notion.dataSources.retrieve({
        data_source_id: dataSourceId,
      });
      carModelOptions =
        dataSource.properties?.["車款"]?.select?.options?.map(
          (o) => o.name
        ) || [];

      schemaCache = { dataSourceId, carModelOptions, fetchedAt: Date.now() };
    }

    const searchMatchesCarModelOption = carModelOptions.includes(search);

    // Default (loose) filter — substring search across the text fields.
    let orConditions = [
      { property: "車牌", title: { contains: search } },
      { property: "登記人", rich_text: { contains: search } },
    ];
    if (searchMatchesCarModelOption) {
      orConditions.push({ property: "車款", select: { equals: search } });
    }
    let filter = { or: orConditions };

    // ===== EXACT MATCH & SINGLE RESULT LIMIT FOR SECURITY =====
    // Overrides the loose filter above so only an exact string match
    // qualifies. TO REVERT TO LOOSE SEARCH: delete this block (down to the
    // matching END marker) — the `filter` built above will be used as-is.
    orConditions = [
      { property: "車牌", title: { equals: search } },
      { property: "登記人", rich_text: { equals: search } },
    ];
    if (searchMatchesCarModelOption) {
      orConditions.push({ property: "車款", select: { equals: search } });
    }
    filter = { or: orConditions };
    // ===== END EXACT MATCH & SINGLE RESULT LIMIT FOR SECURITY =====

    // Let Notion do the filtering in the cloud — only matching rows come back.
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      filter,
    });

    let results = response.results;

    // ===== EXACT MATCH & SINGLE RESULT LIMIT FOR SECURITY =====
    // Even with an exact filter, Notion can still return more than one row
    // (e.g. duplicate plates). Force only a single row back to the client.
    // TO REVERT: delete this block (down to the matching END marker).
    results = results.slice(0, 1);
    // ===== END EXACT MATCH & SINGLE RESULT LIMIT FOR SECURITY =====

    const plates = results.map((page) => {
      const props = page.properties;

      return {
        id: page.id,
        licensePlate: props["車牌"]?.title?.[0]?.plain_text || "",
        registrant: props["登記人"]?.rich_text?.[0]?.plain_text || "",
        phone: props["登記電話"]?.phone_number || "",
        carModel: props["車款"]?.select?.name || "",
        // "分類" is a select property with two options: 汽車 (car) / 機車
        // (motorcycle). Exposed as-is so the frontend can branch on it.
        category: props["分類"]?.select?.name || "",
      };
    });

    return NextResponse.json(plates);
  } catch (error) {
    // Notion SDK errors (APIResponseError) carry a `code` (e.g.
    // "unauthorized", "object_not_found", "validation_error") and `status`
    // that are far more useful for diagnosing production issues via
    // `wrangler tail` / the dashboard Logs tab than the bare error object.
    console.error("Notion search failed:", {
      name: error?.name,
      message: error?.message,
      code: error?.code,
      status: error?.status,
    });
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
