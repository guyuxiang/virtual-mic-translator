// esbuild bundle for the renderer (browser/Chromium context).
// Bundles livekit-client + app.ts into a single IIFE the HTML can <script src>.
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/renderer/app.ts'],
  bundle: true,
  outfile: 'dist/renderer/app.js',
  platform: 'browser',
  format: 'iife',
  target: ['chrome120'],
  sourcemap: true,
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('[esbuild] watching renderer...');
} else {
  await esbuild.build(options);
  console.log('[esbuild] renderer bundled → dist/renderer/app.js');
}
