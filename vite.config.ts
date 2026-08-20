import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const appVersion = process.env.VERCEL_GIT_COMMIT_SHA || Date.now().toString();

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    rollupOptions: {
      plugins: [{
        name: 'splitmate-build-version',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'version.json',
            source: JSON.stringify({ version: appVersion }),
          });
        },
      }],
    },
  },
});
