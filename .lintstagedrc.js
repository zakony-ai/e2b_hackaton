export default {
  "*.{js,ts,tsx,jsx,json}": ["pnpm biome format --write"],
  "*.md": ["prettier --write"],
};
