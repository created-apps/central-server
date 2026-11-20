import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This folder is the project root. Without it, Next picks up a lockfile in a
  // parent folder and traces files from there.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
