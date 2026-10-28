import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // Туннели (cloudflared/ngrok) приходят с произвольным Host.
    allowedHosts: true,
    proxy: {
      '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
      '/media': {
        target: process.env.MEDIA_PROXY_TARGET ?? 'http://localhost:9000',
        rewrite: (path) => path.replace(/^\/media/, '/standup'),
      },
    },
  },
});
