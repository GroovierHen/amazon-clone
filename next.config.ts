import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Serves the static shell of pages that were not prerendered, then fills them in.
  partialPrefetching: true,
  images: {
    // Keep optimized images for a month and offer few widths: the free plan
    // limits how many image transformations a month it will do.
    minimumCacheTTL: 60 * 60 * 24 * 31,
    deviceSizes: [640, 828, 1200],
    imageSizes: [64, 128, 256, 384],
    // Seed product photos load from the sample dataset's own CDN (SPEC.md 3.1).
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.dummyjson.com",
        pathname: "/product-images/**",
      },
    ],
  },
};

export default nextConfig;
