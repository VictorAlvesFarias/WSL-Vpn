// Bundles the Electron main process together with the API server into a single ESM file,
// so the packaged app needs no node_modules.
import { build } from 'esbuild';

await build({
  entryPoints: ['desktop/main.ts'],
  outfile: 'desktop/dist/main.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['electron'],
  // Bundled CommonJS dependencies (express) call require(); give ESM a real one.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});
