const allowedHosts = process.env.ALLOWED_HOSTS
  ? process.env.ALLOWED_HOSTS.split(',').map(h => h.trim())
  : true;

export default {
  preview: {
    port: 3000,
    host: true,
    allowedHosts,
    proxy: {
      '/api': { target: process.env.API_TARGET ?? 'http://localhost:8080', changeOrigin: true },
      '/openapi': { target: process.env.API_TARGET ?? 'http://localhost:8080', changeOrigin: true },
    },
  },
}
