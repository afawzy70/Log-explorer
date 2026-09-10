# syntax=docker/dockerfile:1
#
# IMPLEMENTATION_PLAN.md "Phase K" scope item 1: one deployable image.
# Three stages: Vite build -> Maven build (embedding the Vite output as
# Spring Boot static resources) -> a minimal non-root JRE runtime. No
# build secrets in any layer - the build needs none (no private registry,
# no signing key), and nothing here declares one.

# ---- Stage 1: frontend build --------------------------------------------
FROM node:20-alpine AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: backend build, embedding the frontend build ---------------
FROM eclipse-temurin:21-jdk-alpine AS backend-build
WORKDIR /backend
COPY backend/.mvn/ .mvn/
COPY backend/mvnw ./
RUN chmod +x mvnw
COPY backend/pom.xml ./
# Warms the local Maven repo layer so a source-only change doesn't
# re-download every dependency - best-effort (a plugin resolved only in a
# later phase can still cause a cache miss here, harmlessly).
RUN ./mvnw -q -B dependency:go-offline || true
COPY backend/src ./src
# The Vite build becomes Spring Boot's static resources - the same
# "single deployable image" pattern the plan itself calls for
# (IMPLEMENTATION_PLAN.md §4.3). SpaWebFluxConfig (Phase K) serves it with
# an SPA fallback that never swallows /api/** or /actuator/**.
COPY --from=frontend-build /frontend/dist ./src/main/resources/static
RUN ./mvnw -q -B -DskipTests package

# ---- Stage 3: runtime -----------------------------------------------------
FROM eclipse-temurin:21-jre-alpine AS runtime

# Non-root runtime user (CLAUDE.md §8 "Non-root runtime image"). su-exec is
# how docker-entrypoint.sh drops from root to this user before ever
# exec'ing the JVM - see that script's own header for why the image still
# starts as root at all.
RUN apk add --no-cache su-exec && \
    addgroup -S logexplorer && adduser -S logexplorer -G logexplorer

WORKDIR /app
COPY --from=backend-build /backend/target/*.jar app.jar
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chown logexplorer:logexplorer app.jar && chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3434
# Legacy Remediation Slice 9 §B/§K: 3434 is the project's formal default
# port. SERVER_ADDRESS=0.0.0.0 (not the application's own 127.0.0.1
# default - see application.yml's own comment) because this process runs
# inside the container's own network namespace, where Docker's host-side
# port publish (docker-compose.yml scopes that publish to 127.0.0.1) is
# what actually enforces "never reachable beyond the host's own
# loopback" - binding to 127.0.0.1 *inside* the container would make it
# unreachable even from its own published port.
ENV SERVER_PORT=3434
ENV SERVER_ADDRESS=0.0.0.0
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD wget -q -O- http://127.0.0.1:${SERVER_PORT}/actuator/health | grep -q '"status":"UP"' || exit 1

# Deliberately no USER here - docker-entrypoint.sh itself drops to the
# non-root `logexplorer` user via su-exec before ever running java. The
# application process is non-root on every profile, including
# `docker-socket` (verified: `docker exec ... ps` shows the java process
# owned by `logexplorer`, never root - see docs/verification/PHASE_K_REPORT.md).
ENTRYPOINT ["docker-entrypoint.sh"]
