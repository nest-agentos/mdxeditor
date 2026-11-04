import {defineConfig} from 'tsup';

/** Emit portable ESM/CJS declarations after Vite has built browser JavaScript and CSS. */
export default defineConfig({entry: {"index": "src/index.ts"}, format: ['esm', 'cjs'],
    dts: {only: true}, clean: false, outDir: 'dist'});
