export default {
  preview: {
    port: 3000,
    host: true,
    allowedHosts: 'all',
    proxy: {
      '/api': { target: process.env.API_TARGET ?? 'http://localhost:8080', changeOrigin: true },
      '/openapi': { target: process.env.API_TARGET ?? 'http://localhost:8080', changeOrigin: true },
    },
  },
}
