import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    // The training worker is loaded by path at runtime, so it is its own bundle.
    'train-worker': 'src/modules/training/worker.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // The workspace package ships TypeScript source; bundle it in.
  noExternal: ['@crowd/shared'],
});
