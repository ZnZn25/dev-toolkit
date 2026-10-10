import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { createPingMiddleware } from './scripts/ping-http.mjs'

const localPing: Plugin = {
  name: 'local-ping',
  configureServer(server) { server.middlewares.use(createPingMiddleware()) },
  configurePreviewServer(server) { server.middlewares.use(createPingMiddleware()) },
}

export default defineConfig({
  plugins: [vue(), localPing],
  clearScreen: false,
  server: { strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: { target: 'es2022' },
  worker: { format: 'es' },
})
