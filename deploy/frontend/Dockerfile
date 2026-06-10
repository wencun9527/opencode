# PVF AI Editor - Frontend Builder
# 多阶段构建：Node 构建 → 输出静态文件到共享 volume
FROM node:20-alpine AS builder
WORKDIR /build

# 复制依赖文件
COPY package.json package-lock.json ./
RUN npm ci

# 复制源码和配置
COPY index.html ./
COPY vite.config.ts tsconfig.json ./
COPY src ./src/

# 构建参数：API 基地址（生产环境由 Caddy 代理）
ARG VITE_RELAY_WS_URL=ws://localhost/ws
ARG VITE_OPENCODE_REMOTE_URL=http://localhost/api
ARG VITE_RELAY_URL=http://localhost

# 构建
RUN npm run build

# 生产阶段：输出 dist/ 到共享 volume
FROM alpine:3.19 AS dist
COPY --from=builder /build/dist /srv/frontend
