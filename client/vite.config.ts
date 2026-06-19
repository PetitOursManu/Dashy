import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, the SPA runs on :5173 and proxies API + hosted-app requests to the
// Express backend on :3000 so cookies stay same-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/hosted': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    // Output straight into the server's static dir for the single-container build.
    outDir: '../server/public',
    emptyOutDir: true,
  },
});
