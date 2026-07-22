import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default {
  ...defineCloudflareConfig(),
  // The OpenNext Cloudflare adapter doesn't support Turbopack yet
  // (https://github.com/opennextjs/opennextjs-cloudflare/issues/569), and
  // Next.js 16 defaults to Turbopack. Force Webpack for the Cloudflare
  // build only — `next dev`/`next build` elsewhere are unaffected.
  buildCommand: "next build --webpack",
};
