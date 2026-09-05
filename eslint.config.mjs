import { defineConfig } from "eslint/config";
import globals from "globals";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig(
  ...obsidianmd.configs.recommended,
  {
    ignores: [
      "main.js",
      "node_modules/**",
      ".testvaults/**",
      "tests/**",
      "scripts/**",
      "dist/**",
      "config/**",
      "src/emberly-engine/**/*.js",
      "src/topics/fractions.js",
      "esbuild.config.mjs",
    ],
  },
  {
    files: ["**/*.{js,mjs,ts}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: { allowDefaultProject: ["eslint.config.mjs"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // The current rule reports already-correct multi-sentence and branded UI
      // strings as violations. UI copy is reviewed directly against the style guide.
      "obsidianmd/ui/sentence-case": "off",
    },
  },
);
