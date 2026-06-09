#!/bin/bash
# PVF AI Editor - 一键服务器部署脚本
# 目标: Ubuntu 22.04, IP: 1.12.207.131
# 用法: ssh root@1.12.207.131 然后运行此脚本

set -e

SERVER_IP="1.12.207.131"
INSTALL_DIR="/opt/pvf-ai-editor"

echo "========================================="
echo " PVF AI Editor - Server Setup"
echo " Target: ${SERVER_IP} (Ubuntu 22.04)"
echo "========================================="

# ─── 1. 系统更新 ───
echo ""
echo "[1/7] Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

# ─── 2. 安装 Docker ───
echo ""
echo "[2/7] Installing Docker..."
if command -v docker &> /dev/null; then
    echo "  Docker already installed: $(docker --version)"
else
    # Add Docker official GPG key
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    
    # Add Docker repository
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
    
    apt-get update -qq
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    
    systemctl enable docker
    systemctl start docker
    echo "  Docker installed: $(docker --version)"
fi

# ─── 3. 安装 Git ───
echo ""
echo "[3/7] Installing Git..."
if command -v git &> /dev/null; then
    echo "  Git already installed: $(git --version)"
else
    apt-get install -y git
    echo "  Git installed: $(git --version)"
fi

# ─── 4. 安装其他工具 ───
echo ""
echo "[4/7] Installing utilities..."
apt-get install -y curl ufw

# ─── 5. 克隆项目 ───
echo ""
echo "[5/7] Cloning project..."
if [ -d "${INSTALL_DIR}" ]; then
    echo "  Directory ${INSTALL_DIR} exists, pulling latest..."
    cd ${INSTALL_DIR}
    git pull || echo "  Git pull failed, using existing code"
else
    git clone https://github.com/wencun9527/opencode.git ${INSTALL_DIR}
    cd ${INSTALL_DIR}
fi

# ─── 6. 配置环境变量 ───
echo ""
echo "[6/7] Configuring environment..."
cd ${INSTALL_DIR}/deploy

if [ -f .env.local ]; then
    echo "  .env.local already exists, skipping"
else
    # 生成强密码和 JWT 密钥
    DB_PASSWORD=$(openssl rand -hex 16)
    JWT_SECRET=$(openssl rand -hex 32)
    
    cat > .env.local << EOF
# Auto-generated on $(date)
DB_PASSWORD=${DB_PASSWORD}
JWT_SECRET=${JWT_SECRET}
DEEPSEEK_API_KEY=sk-YOUR_DEEPSEEK_KEY_HERE
SERVER_IP=${SERVER_IP}
EOF
    
    echo "  .env.local created with random secrets"
    echo "  *** IMPORTANT: Edit .env.local and set DEEPSEEK_API_KEY ***"
    echo "  Run: nano ${INSTALL_DIR}/deploy/.env.local"
fi

# ─── 7. 防火墙 ───
echo ""
echo "[7/7] Configuring firewall..."
ufw --force enable
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS (future)
ufw status

echo ""
echo "========================================="
echo " Setup Complete!"
echo "========================================="
echo ""
echo "Next steps:"
echo ""
echo "  1. Set your DeepSeek API key:"
echo "     nano ${INSTALL_DIR}/deploy/.env.local"
echo ""
echo "  2. Build and start services:"
echo "     cd ${INSTALL_DIR}/deploy"
echo "     docker compose --env-file .env.local up -d --build"
echo ""
echo "  3. Check service status:"
echo "     docker compose ps"
echo "     docker compose logs -f"
echo ""
echo "  4. Test the deployment:"
echo "     curl http://${SERVER_IP}/health"
echo ""
echo "  5. Register a test user:"
echo "     curl -X POST http://${SERVER_IP}/auth/register \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"email\":\"admin@test.com\",\"password\":\"admin123\"}'"
echo ""
