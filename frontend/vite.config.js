import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import shsApi from './shs-api-plugin.js';

export default defineConfig(({ mode }) => {
  const { SHS_API_KEY } = loadEnv(mode, process.cwd(), 'SHS_');

  return {
    publicDir: 'data',
    esbuild: {
      loader: 'jsx',
      include: /src\/.*\.js$/,
      exclude: [],
    },
    optimizeDeps: {
      esbuildOptions: {
        loader: { '.js': 'jsx' },
      },
    },
    server: {
      // Cached API responses are rewritten while the app loads; don't trigger reloads.
      watch: { ignored: ['**/.shs-cache/**'] },
    },
    plugins: [
      react({ include: /\.[jt]sx?$/ }),
      shsApi({ apiKey: SHS_API_KEY, cacheDir: '.shs-cache' }),
    ],
  };
});
