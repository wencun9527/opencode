#!/bin/bash
# PVF-AI-Editor 云端 OpenCode 部署脚本
# 在 1.12.207.131 上执行（OpenCode 不在 Docker 内，独立 systemd 运行）
# 用法: bash deploy-cloud.sh

set -e

echo "=== PVF-AI-Editor 云端 OpenCode 部署 ==="

# 1. 更新 opencode.json
echo "[1/4] 更新 opencode.json..."

OPENCODE_CONFIG=""
for path in \
  "/opt/pvf-ai-editor/opencode.json" \
  "/root/PVF-AI-Editor/opencode.json" \
  "/root/opencode.json" \
  "$(pwd)/opencode.json"; do
  if [ -f "$path" ]; then
    OPENCODE_CONFIG="$path"
    break
  fi
done

if [ -z "$OPENCODE_CONFIG" ]; then
  echo "⚠️  未找到 opencode.json，将创建新的"
  OPENCODE_CONFIG="/opt/pvf-ai-editor/opencode.json"
  mkdir -p "$(dirname "$OPENCODE_CONFIG")"
fi

cat > "$OPENCODE_CONFIG" << 'EOF'
{
  "$schema": "https://opencode.ai/config.json",
  "model": "deepseek/deepseek-chat",
  "provider": {
    "deepseek": {
      "options": {
        "apiKey": "{env:DEEPSEEK_API_KEY}"
      }
    }
  },
  "mcp": {
    "pvfutility": {
      "type": "url",
      "url": "http://localhost:9100/mcp",
      "enabled": true,
      "timeout": 30000
    }
  }
}
EOF

echo "✅ opencode.json 已更新: $OPENCODE_CONFIG"

# 2. 确保 DEEPSEEK_API_KEY 已设置
echo "[2/4] 检查 DEEPSEEK_API_KEY..."
if [ -z "$DEEPSEEK_API_KEY" ]; then
  echo "⚠️  DEEPSEEK_API_KEY 未设置！"
  echo "   请运行: export DEEPSEEK_API_KEY=your-key-here"
  echo "   然后重新运行此脚本"
  exit 1
fi
echo "✅ DEEPSEEK_API_KEY 已设置"

# 3. 重启 OpenCode 服务
echo "[3/4] 重启 OpenCode..."
if systemctl is-active --quiet opencode 2>/dev/null; then
  systemctl restart opencode
  echo "✅ OpenCode 服务已重启"
elif pgrep -f "opencode serve" > /dev/null 2>&1; then
  pkill -f "opencode serve"
  sleep 2
  DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" nohup opencode serve > /var/log/opencode.log 2>&1 &
  echo "✅ OpenCode 进程已重启"
else
  DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" nohup opencode serve > /var/log/opencode.log 2>&1 &
  echo "✅ OpenCode 进程已启动"
fi

# 4. 验证
echo "[4/4] 验证服务状态..."
sleep 3

RELAY_HEALTH=$(curl -s http://localhost:9100/health 2>/dev/null || echo "unreachable")
echo "Relay: $RELAY_HEALTH"

OPENCODE_HEALTH=$(curl -s http://localhost:4096/api/health 2>/dev/null || echo "unreachable")
echo "OpenCode: $OPENCODE_HEALTH"

echo ""
echo "=== 部署完成 ==="
echo "数据流: 用户 → Caddy → OpenCode API → AI → MCP → Relay → WS → 前端 → PVFut"
