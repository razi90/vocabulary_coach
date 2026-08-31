FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    APP_DIR=/app

WORKDIR /app

# Only one dependency (pg); its own layer so it stays in the cache.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY index.html manifest.webmanifest sw.js ./
COPY src/ ./src/
COPY server/ ./server/
COPY mcp/ ./mcp/
COPY db/ ./db/
COPY beispiele/ ./beispiele/

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/server.js"]
