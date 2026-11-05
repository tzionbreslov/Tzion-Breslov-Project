import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      ".next/**",
      "content/**",
      ".wrangler/**",
      ".tmp/**",
      "dist/**",
      "next-env.d.ts",
      "node_modules/**",
      "out/**",
      "public/**",
      "test-results/**",
      "video/**",
      "video-upscale-samples/**",
      "index-backup*.html",
      "*.html",
      "gallery-experience.js",
      "navigation.js",
      "schedule-data.js"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs}"],
    plugins: {
      "@next/next": nextPlugin
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      "@next/next/no-img-element": "off",
      // App Router root layouts render <head> directly; this rule targets the Pages Router.
      "@next/next/no-head-element": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
      "no-unused-vars": "off"
    }
  }
];
