FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN apk add --no-cache python3 make g++ && npm ci --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S cosmos && adduser -S cosmos -G cosmos
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY config ./config
RUN mkdir -p /app/data && chown -R cosmos:cosmos /app
USER cosmos
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/meta || exit 1
CMD ["node", "src/server.js"]
