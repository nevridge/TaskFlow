import { defineConfig } from 'vite'

export default defineConfig({
  preview: {
    proxy: {
      '/api': { target: process.env.API_TARGET ?? 'http://localhost:8080', changeOrigin: true },
      '/openapi': { target: process.env.API_TARGET ?? 'http://localhost:8080', changeOrigin: true },
    },
  },
})
