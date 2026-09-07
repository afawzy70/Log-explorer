# H2 (Phase A2a) - mock Loki server. Zero npm dependencies.
# Used by Phase D's mock-based Loki adapter verification and by Compose's
# `loki-mock` profile (Phase K) for offline Loki-path demonstration.

FROM node:20-alpine

WORKDIR /app
COPY server.js package.json ./
USER node

ENV PORT=3100
EXPOSE 3100

CMD ["node", "server.js"]
