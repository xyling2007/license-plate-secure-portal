import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Drop the "X-Powered-By: Next.js" response header — no functional
  // benefit to advertising the framework on a public-facing endpoint.
  poweredByHeader: false,
};

export default nextConfig;

// Lets `next dev` (not just `wrangler`/`opennextjs-cloudflare preview`) see
// local emulations of Cloudflare bindings, e.g. the rate limiter used in
// src/app/api/search/route.js.
initOpenNextCloudflareForDev();
