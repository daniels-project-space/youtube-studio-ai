import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".trigger/**",
    "graphify-out/**",
    "motion-graphics/out/**",
    "motion-graphics/public/**",
    "out/**",
    "public/**",
    "src/geo/assets/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
