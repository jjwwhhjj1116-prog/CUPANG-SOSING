import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Pinned upstream OCR bundles are checked by the artifact/hash verifier;
  // application lint rules must not rewrite their generated Wasm loaders.
  globalIgnores(['.next/**', 'out/**', 'build/**', 'dist/**', '.wrangler/**', 'outputs/**', 'next-env.d.ts', 'extensions/supplier-hub/mobile-public.mjs', 'public/ocr/**']),
]);

export default eslintConfig;
