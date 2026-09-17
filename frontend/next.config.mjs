/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Source maps would expose backend structure and internal naming to anyone
  // opening devtools on the customer portal.
  productionBrowserSourceMaps: false,
  poweredByHeader: false,
};

export default nextConfig;
