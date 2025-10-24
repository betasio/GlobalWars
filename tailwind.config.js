// tailwind.config.js
import defaultTheme from "tailwindcss/defaultTheme";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{html,ts,js}"],
  theme: {
    extend: {
      colors: {
        "gw-navy": "#050c18",
        "gw-midnight": "#0b213f",
        "gw-cerulean": "#2ab6ff",
        "gw-ice": "#61e6ff",
        "gw-ember": "#ff6b91",
        "gw-gold": "#f0b545",
        "gw-emerald": "#53d58d",
      },
      fontFamily: {
        sans: ["Inter", ...defaultTheme.fontFamily.sans],
        display: ["Audiowide", "Orbitron", ...defaultTheme.fontFamily.sans],
      },
      boxShadow: {
        "gw-focus": "0 18px 45px rgba(42, 182, 255, 0.35)",
        "gw-soft": "0 24px 60px rgba(3, 11, 24, 0.35)",
      },
    },
  },
  plugins: [],
  darkMode: "class",
};
