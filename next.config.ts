import type { NextConfig } from "next";
const config: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  poweredByHeader: false,
  outputFileTracingIncludes: { "/api/labels/*": ["./assets/fonts/**/*"] },
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
    ];
  },
};
export default config;
