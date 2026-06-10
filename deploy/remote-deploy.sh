#!/bin/bash
# PVF AI Editor - 远程一键部署脚本
# 在服务器上直接运行: bash <(curl -sL http://YOUR_IP/deploy.sh) 或手动上传执行
# 用法: bash remote-deploy.sh

set -e

INSTALL_DIR="/opt/pvf-ai-editor"

echo "========================================="
echo " PVF AI Editor - Remote Deploy"
echo "========================================="

# ─── 1. 系统依赖 ───
echo ""
echo "[1/6] Installing system dependencies..."
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y curl git ufw

# ─── 2. Docker ───
echo ""
echo "[2/6] Installing Docker..."
if command -v docker &> /dev/null; then
    echo "  Docker already installed: $(docker --version)"
else
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
    apt-get update -qq
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable docker
    systemctl start docker
    echo "  Docker installed: $(docker --version)"
fi

# ─── 3. 克隆代码 ───
echo ""
echo "[3/6] Cloning project..."
if [ -d "${INSTALL_DIR}" ]; then
    echo "  Directory exists, pulling latest..."
    cd ${INSTALL_DIR}
    git pull || echo "  Git pull failed, using existing code"
else
    git clone https://github.com/wencun9527/opencode.git ${INSTALL_DIR}
    cd ${INSTALL_DIR}
fi

# ─── 4. 配置环境变量 ───
echo ""
echo "[4/6] Configuring environment..."
cd ${INSTALL_DIR}/deploy

if [ -f .env.local ]; then
    echo "  .env.local already exists, skipping"
else
    DB_PASSWORD=$(openssl rand -hex 16)
    JWT_SECRET=$(openssl rand -hex 32)
    SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || echo "YOUR_SERVER_IP")

    cat > .env.local << EOF
# Auto-generated on $(date)
DB_PASSWORD=${DB_PASSWORD}
JWT_SECRET=${JWT_SECRET}
DEEPSEEK_API_KEY=sk-YOUR_DEEPSEEK_KEY_HERE
REQUIRE_AUTH=true
SERVER_IP=${SERVER_IP}
EOF

    echo "  .env.local created with random secrets"
    echo "  *** IMPORTANT: Edit .env.local and set DEEPSEEK_API_KEY ***"
fi

# ─── 5. 构建并启动 ───
echo ""
echo "[5/6] Building and starting services..."
docker compose --env-file .env.local up -d --build

# ─── 6. 防火墙 ───
echo ""
echo "[6/6] Configuring firewall..."
ufw --force enable
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
# ufw allow 443/tcp  # HTTPS (域名模式启用)
ufw status

# ─── 验证 ───
echo ""
echo "Waiting for services to start..."
sleep 15

SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || echo "YOUR_SERVER_IP")
HEALTH=$(curl -s http://localhost/health 2>/dev/null || echo "unreachable")

echo ""
echo "========================================="
echo " Deploy Complete!"
echo "========================================="
echo ""
echo "  Server IP: ${SERVER_IP}"
echo "  Health:    ${HEALTH}"
echo ""
echo "  Frontend:  http://${SERVER_IP}"
echo "  Auth API:  http://${SERVER_IP}/auth/register"
echo "  Health:    http://${SERVER_IP}/health"
echo ""
echo "Next steps:"
echo "  1. Set DEEPSEEK_API_KEY:"
echo "     nano ${INSTALL_DIR}/deploy/.env.local"
echo "     docker compose --env-file .env.local up -d --build relay"
echo ""
echo "  2. Register a test user:"
echo "     curl -X POST http://${SERVER_IP}/auth/register \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"email\":\"admin@test.com\",\"password\":\"admin123\"}'"
echo ""
