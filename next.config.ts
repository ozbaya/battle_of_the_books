import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // getQuestions() reads this file via fs + path.join(process.cwd(), ...) at
  // request time; Next's build-time file tracing doesn't always resolve that
  // pattern statically, which can silently leave it out of the deployed
  // serverless function bundle on Vercel. Force it in explicitly.
  outputFileTracingIncludes: {
    "/*": ["./questions/questions.md", "./questions/hard.md"],
  },
};

export default nextConfig;
