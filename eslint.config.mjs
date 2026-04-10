import js from "@eslint/js";
import tseslint from "typescript-eslint";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["tests/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: path.join(__dirname, "tsconfig.json"),
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // ── Qualidade geral ──────────────────────────────────
      "no-console":           "off",
      "no-unused-vars":       "off",
      "no-duplicate-imports": "error",

      // ── TypeScript ───────────────────────────────────────
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      "@typescript-eslint/no-explicit-any":               "warn",
      "@typescript-eslint/no-floating-promises":          "error",
      "@typescript-eslint/no-misused-promises":           "error",
      "@typescript-eslint/await-thenable":                "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",

      // ── Segurança ─────────────────────────────────────────
      "no-eval":         "error",
      "no-implied-eval": "error",

      // ── Estilo / manutenibilidade ─────────────────────────
      "eqeqeq":       ["error", "always"],
      "no-var":       "error",
      "prefer-const": "warn",
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", "*.js"],
  }
);
