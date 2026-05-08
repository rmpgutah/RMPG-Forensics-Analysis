import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8'));
const APP_VERSION_DEFINE = { __APP_VERSION__: JSON.stringify(pkg.version) };

export default defineConfig({
  main: {
    define: APP_VERSION_DEFINE,
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
    define: APP_VERSION_DEFINE,
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
    define: APP_VERSION_DEFINE,
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
