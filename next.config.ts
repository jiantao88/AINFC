import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@libsql/client", "libsql"],
  outputFileTracingIncludes: { "/*": ["./fixtures/demo/**/*"] },
  outputFileTracingExcludes: { "/*": ["./docs/**", "./data/**"] },
};

export default config;
