import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        orbitron: ["var(--font-orbitron)"],
        mono: ["var(--font-space-mono)", "monospace"],
        sans: ["var(--font-outfit)", "sans-serif"],
      },
      colors: {
        neural: {
          bg: "#000508",
          surface: "#040d1a",
          border: "rgba(0,212,255,0.15)",
        },
        neon: {
          cyan: "#00D4FF",
          magenta: "#FF0080",
          green: "#00FF88",
          amber: "#FFB800",
          purple: "#8B5CF6",
          orange: "#FF6B00",
        },
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "spin-slow": "spin 8s linear infinite",
        "grid-move": "gridMove 20s linear infinite",
        "flicker": "flicker 4s step-end infinite",
        "scan": "scan 4s linear infinite",
      },
      keyframes: {
        gridMove: {
          "0%": { backgroundPosition: "0 0, -30px -30px, -30px -30px" },
          "100%": { backgroundPosition: "0 0, 30px 30px, 30px 30px" },
        },
        flicker: {
          "0%, 95%, 100%": { opacity: "1" },
          "96%": { opacity: "0.4" },
          "97%": { opacity: "1" },
          "98%": { opacity: "0.2" },
          "99%": { opacity: "1" },
        },
        scan: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100vh)" },
        },
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};

export default config;
