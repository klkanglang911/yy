#!/bin/bash

# YouTube直播流转发系统安装脚本

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# 检查是否为root用户
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}请使用root权限运行此脚本${NC}"
  exit 1
fi

echo -e "${GREEN}开始安装YouTube直播流转发系统...${NC}"

# 检查Docker是否已安装
if ! command -v docker &> /dev/null; then
  echo -e "${YELLOW}Docker未安装，正在安装...${NC}"
  
  # 更新包列表
  apt-get update
  
  # 安装依赖
  apt-get install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release
  
  # 添加Docker官方GPG密钥
  curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
  
  # 设置稳定版仓库
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian \
    $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
  
  # 更新包索引
  apt-get update
  
  # 安装Docker Engine
  apt-get install -y docker-ce docker-ce-cli containerd.io
  
  # 启动Docker
  systemctl start docker
  systemctl enable docker
  
  echo -e "${GREEN}Docker安装完成${NC}"
else
  echo -e "${GREEN}Docker已安装${NC}"
fi

# 检查Docker Compose是否已安装
if ! command -v docker-compose &> /dev/null; then
  echo -e "${YELLOW}Docker Compose未安装，正在安装...${NC}"
  
  # 下载Docker Compose
  curl -L "https://github.com/docker/compose/releases/download/1.29.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
  
  # 添加执行权限
  chmod +x /usr/local/bin/docker-compose
  
  echo -e "${GREEN}Docker Compose安装完成${NC}"
else
  echo -e "${GREEN}Docker Compose已安装${NC}"
fi

# 创建必要的目录
echo -e "${YELLOW}创建必要的目录...${NC}"
mkdir -p data/cache data/logs/nginx data/logs/stream-service data/streams data/ssl

# 设置权限
chmod -R 755 data

# 创建.env文件
if [ ! -f .env ]; then
  echo -e "${YELLOW}创建.env文件...${NC}"
  cp .env.example .env
  echo -e "${GREEN}.env文件已创建，请编辑此文件设置您的API密钥和其他配置${NC}"
else
  echo -e "${GREEN}.env文件已存在${NC}"
fi

# 构建并启动服务
echo -e "${YELLOW}构建并启动服务...${NC}"
docker-compose up -d --build

# 检查服务状态
echo -e "${YELLOW}检查服务状态...${NC}"
docker-compose ps

echo -e "${GREEN}安装完成！${NC}"
echo -e "${YELLOW}请访问 http://your-server-ip 查看监控页面${NC}"
echo -e "${YELLOW}请确保已在.env文件中设置了正确的YouTube API密钥${NC}"
