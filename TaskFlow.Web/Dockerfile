FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY vite.preview.config.js ./
EXPOSE 3000
CMD ["node_modules/.bin/vite", "preview", "--config", "vite.preview.config.js", "--host", "0.0.0.0", "--port", "3000"]
