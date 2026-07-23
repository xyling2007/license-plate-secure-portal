# 車牌查詢入口 (License Plate Search Portal)

An internal license plate / registrant lookup tool built with [Next.js](https://nextjs.org), backed by a [Notion](https://developers.notion.com) database, and deployed to [Cloudflare Workers](https://developers.cloudflare.com/workers/) via the [OpenNext Cloudflare adapter](https://opennext.js.org/cloudflare).

## Stack

- **Framework:** Next.js 16 (App Router)
- **Data source:** Notion database, accessed through `@notionhq/client`
- **Hosting:** Cloudflare Workers, via `@opennextjs/cloudflare`
- **Styling:** Tailwind CSS v4

## Getting started

Install dependencies, then run the dev server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app. The search UI lives in `src/components/PlatesTable.js`, and the API route it calls is `src/app/api/search/route.js`.

### Local environment variables

Create a `.env.local` file in the project root (this is git-ignored, never commit it) with:

```
NOTION_API_KEY=secret_or_ntn_...
NOTION_DATABASE_ID=...
```

## Building and deploying to Cloudflare

This project deploys as a Cloudflare Worker, not to Vercel. See `wrangler.jsonc` for the Worker configuration.

```bash
npm run preview   # build + run locally on the Workers runtime
npm run deploy    # build + deploy to Cloudflare
```

In production, `NOTION_API_KEY` and `NOTION_DATABASE_ID` are set as **Secrets** under the Worker's **Settings > Variables and Secrets** in the Cloudflare dashboard — not in this repo.

Git pushes to `main` also trigger an automatic build + deploy via Cloudflare Workers Builds (Build command: `npx @opennextjs/cloudflare build`, Deploy command: `npx @opennextjs/cloudflare deploy`).

## Maintainer / Contact

- **Name:** 林孝揚
- **Email:** [xyling2007@gmail.com](mailto:xyling2007@gmail.com)
- **Phone:** 0966649275
