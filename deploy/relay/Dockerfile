# Tool Relay Service - Bun Runtime
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY src/ ./src/

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:9100/health || exit 1

# Environment
ENV RELAY_PORT=9100
ENV TOOL_CALL_TIMEOUT=60000
ENV NODE_ENV=production

EXPOSE 9100

CMD ["bun", "run", "src/index.ts"]
