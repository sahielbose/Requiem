import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0a0b0e",
        panel: "#111317",
        border: "#1f232b",
        muted: "#7a8593",
        text: "#e6e9ee",
        accent: "#7c9eff",
        critical: "#ef4444",
        warning: "#f59e0b",
        info: "#3b82f6",
        success: "#10b981",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
