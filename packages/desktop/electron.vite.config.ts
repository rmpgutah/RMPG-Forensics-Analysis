import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({
      exclude: ['@rmpg/shared', 'firebase'],
    })],
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@rmpg/shared': resolve('../shared/src'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({
      exclude: ['@rmpg/shared'],
    })],
    resolve: {
      alias: {
        '@rmpg/shared': resolve('../shared/src'),
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@components': resolve('src/renderer/components'),
        '@pages': resolve('src/renderer/pages'),
        '@hooks': resolve('src/renderer/hooks'),
        '@store': resolve('src/renderer/store'),
        // Point renderer directly at shared source (ESM-compatible TS)
        // so Vite can tree-shake and bundle it without CJS interop issues.
        '@rmpg/shared': resolve('../shared/src'),
      },
    },
    plugins: [react()],
  },
});
