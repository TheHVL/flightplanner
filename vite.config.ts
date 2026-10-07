import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' https://avigis.avinor.no 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://cache.kartverket.no https://avigis.avinor.no https://*.tile.openstreetmap.org",
  "connect-src 'self' https://api.open-meteo.com https://ws.geonorge.no https://wcs.geonorge.no https://avigis.avinor.no https://cache.kartverket.no https://*.tile.openstreetmap.org",
  "worker-src 'self' blob:", "object-src 'none'", "base-uri 'self'", "form-action 'self'",
].join('; ');

export default defineConfig({
  plugins: [{ name: 'production-csp', apply: 'build', transformIndexHtml() {
    return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: contentSecurityPolicy }, injectTo: 'head-prepend' }];
  } }],
  base: '/flightplanner/',
  build: { rollupOptions: { input: { manual: resolve('index.html'), generator: resolve('generator.html') } } },
  server: {
    port: 5173,
  },
});
