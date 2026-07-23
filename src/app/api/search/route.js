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

    // Resolve the data source id for this database (Notion API 2025-09-03+).
    const db = await notion.databases.retrieve({
      database_id: notionDatabaseId,
    });
    const dataSourceId = db.data_sources[0].id;

    // Default (loose) filter — substring search across all three fields.
    // Note: "車款" is a Notion `select` property, which only supports
    // `equals`/`does_not_equal` (no `contains`), so it uses `equals` even
    // in this "loose" variant.
    let filter = {
      or: [
        { property: "車牌", title: { contains: search } },
        { property: "登記人", rich_text: { contains: search } },
        { property: "車款", select: { equals: search } },
      ],
    };

    // ===== EXACT MATCH & SINGLE RESULT LIMIT FOR SECURITY =====
    // Overrides the loose filter above so only an exact string match
    // qualifies. TO REVERT TO LOOSE SEARCH: delete this block (down to the
    // matching END marker) — the `filter` built above will be used as-is.
    filter = {
      or: [
        { property: "車牌", title: { equals: search } },
        { property: "登記人", rich_text: { equals: search } },
        { property: "車款", select: { equals: search } },
      ],
    };
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
    console.error(error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
