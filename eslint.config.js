import tseslint from "typescript-eslint";
export default tseslint.config(
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: { parserOptions: { project: "./tsconfig.json" } },
    rules: { "@typescript-eslint/no-floating-promises": "error" },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    languageOptions: { parserOptions: { project: "./apps/web/tsconfig.json" } },
  },
);
