import { defineConfig } from "eslint/config";
import globals from "globals";

export default defineConfig([
  {
    files: ["src/emberly-engine/**/*.js", "src/topics/fractions.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: globals.browser },
    rules: {
      "no-console": ["error", { allow: ["error", "warn"] }],
      "no-debugger": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-var": "error",
      "no-undef": "error",
    },
  },
]);
