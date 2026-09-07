# H1 (Phase A2a) - demo log generator.
# Tiny image, zero npm dependencies, emits deterministic fake Spring Boot
# JSON log lines to stdout/stderr. Used by Compose (Phase K) and by Phase C's
# manual Docker-source verification. Fake data only - see README.md.

FROM node:20-alpine

WORKDIR /app
COPY generate.js package.json ./
USER node

# Run continuously by default (live demo feed). Override the command to pass
# --count/--selftest for a bounded run.
ENTRYPOINT ["node", "generate.js"]
