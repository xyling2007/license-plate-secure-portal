import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
};

export default nextConfig;

// Lets `next dev` (not just `wrangler`/`opennextjs-cloudflare preview`) see
// local emulations of Cloudflare bindings, e.g. the rate limiter used in
// src/app/api/search/route.js.
initOpenNextCloudflareForDev();
