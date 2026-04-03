import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        blue: "#00d4ff",
        deepblue: "#0090cc",
        bg: "#050810",
        card: "#0a0e18",
        human: "#ff8a00",
      },
    },
  },
  plugins: [],
};
export default config;
