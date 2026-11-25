import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // esbuild (Vitest's default transformer) does not emit decorator metadata,
  // which NestJS dependency injection relies on. SWC does.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    // Nest loads reflect-metadata itself, but unit tests of decorated classes
    // (e.g. the env validation) run without Nest and need it loaded first.
    setupFiles: ['reflect-metadata'],
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
  },
});
