import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

import { API_PORT, WEB_PORT } from './shared/ports.js';

// Application strictement locale : on se lie explicitement à 127.0.0.1 pour que
// le serveur de développement ne soit jamais joignable depuis le réseau local.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: WEB_PORT,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: false,
      },
    },
  },
});
