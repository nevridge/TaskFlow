import { defineConfig } from '@hey-api/openapi-ts'

export default defineConfig({
  input: 'http://localhost:8080/openapi/v1.json',
  output: {
    path: './src/api/client',
  },
  plugins: [
    {
      name: '@hey-api/client-fetch',
      baseUrl: false,
    },
    '@hey-api/typescript',
    '@hey-api/sdk',
  ],
})
