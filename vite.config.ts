import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: '/flightplanner/',
  build: { rollupOptions: { input: { manual: resolve('index.html'), generator: resolve('generator.html') } } },
  server: {
    port: 5173,
  },
});
