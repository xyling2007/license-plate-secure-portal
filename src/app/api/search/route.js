import { Client } from "@notionhq/client";
import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

const notion = new Client({ auth: process.env.NOTION_API_KEY });

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

    // Resolve the data source id for this database (Notion API 2025-09-03+).
    const db = await notion.databases.retrieve({
      database_id: process.env.NOTION_DATABASE_ID,
    });
    const dataSourceId = db.data_sources[0].id;

    // Default (loose) filter — substring search across all three fields.
    let filter = {
      or: [
        { property: "車牌", title: { contains: search } },
        { property: "車主", rich_text: { contains: search } },
        { property: "車型", rich_text: { contains: search } },
      ],
    };

    // ===== EXACT MATCH & SINGLE RESULT LIMIT FOR SECURITY =====
    // Overrides the loose filter above so only an exact string match
    // qualifies. TO REVERT TO LOOSE SEARCH: delete this block (down to the
    // matching END marker) — the `filter` built above will be used as-is.
    filter = {
      or: [
        { property: "車牌", title: { equals: search } },
        { property: "車主", rich_text: { equals: search } },
        { property: "車型", rich_text: { equals: search } },
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
        licensePlate: props["車牌"].title[0]?.plain_text || "",
        owner: props["車主"].rich_text[0]?.plain_text || "",
        carModel: props["車型"].rich_text[0]?.plain_text || "",
        contactNumber: props["聯絡電話"]?.phone_number || "",
      };
    });

    return NextResponse.json(plates);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
