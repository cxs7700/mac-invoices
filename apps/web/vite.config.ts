import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // The app calls the API with same-origin relative paths (apiClient base is '').
  // In dev, proxy /api to the local Fastify server (npm run dev:api on :3000) so
  // that mirrors the production Vercel deploy, where /api is same-origin.
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
