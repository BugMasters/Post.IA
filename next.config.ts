import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

// Upload de source maps só acontece quando SENTRY_AUTH_TOKEN existe (CI/Vercel).
export default withSentryConfig(nextConfig, {
  silent: true,
});
