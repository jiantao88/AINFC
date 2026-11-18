import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: { "/*": ["./fixtures/demo/**/*"] },
  outputFileTracingExcludes: { "/*": ["./docs/**", "./data/**"] },
};

export default config;
