import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  if (command === 'build' && mode === 'production' && !env.VITE_API_URL?.trim()) {
    throw new Error('Set VITE_API_URL before building the production frontend (use /api for the Netlify same-origin proxy)');
  }
  return {
    plugins: [react()],
    server: { host: 'localhost', port: 5173 },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('/node_modules/recharts/') || id.includes('/node_modules/d3-')) {
              return 'charts';
            }
            if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
              return 'react-vendor';
            }
          }
        }
      }
    }
  };
});
