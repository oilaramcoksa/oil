import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  compress: true,
  // Smaller first-load JS: import only the icons / motion features that are actually used.
  experimental: { optimizePackageImports: ["lucide-react", "framer-motion", "date-fns", "recharts"] },
  images: { formats: ["image/avif", "image/webp"] },
  async headers() {
    const longCache = [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }];
    return [
      { source: "/:file(.*\\.(?:png|jpg|jpeg|webp|avif|svg|gif|mp3|ogg|wav|woff2))", headers: longCache },
      {
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      ],
    },
    ];
  },
};

export default nextConfig;
