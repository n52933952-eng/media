import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  // Use repo root .env (thredtrain/.env) so VITE_* matches backend dotenv — same file as `node backend/index.js` from root.
  envDir: path.resolve(__dirname, '..'),
  // App is served at site root (e.g. https://xxx.onrender.com/). Do not use a subpath unless you set base.
  base: '/',
  plugins: [
    react(),
    nodePolyfills(),
  ],
  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    include: ['buffer'],
  },
  build: {
    // Enable code splitting and optimization
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'chakra-ui': ['@chakra-ui/react', '@emotion/react', '@emotion/styled', 'framer-motion'],
          'socket-vendor': ['socket.io-client', 'simple-peer'],
        },
      },
    },
    // Optimize chunk size
    chunkSizeWarningLimit: 1000,
  },
})
