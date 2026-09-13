/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@keeperhub/sdk", "@modelcontextprotocol/sdk"],
};

export default nextConfig;
