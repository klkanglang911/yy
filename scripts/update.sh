#!/bin/bash

# YouTube直播流转发系统更新脚本

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}开始更新YouTube直播流转发系统...${NC}"

# 检查git是否已安装
if ! command -v git &> /dev/null; then
  echo -e "${YELLOW}Git未安装，正在安装...${NC}"
  apt-get update
  apt-get install -y git
fi

# 拉取最新代码
echo -e "${YELLOW}拉取最新代码...${NC}"
git pull

# 备份.env文件
if [ -f .env ]; then
  echo -e "${YELLOW}备份.env文件...${NC}"
  cp .env .env.backup
  echo -e "${GREEN}.env文件已备份为.env.backup${NC}"
fi

# 停止并移除旧容器
echo -e "${YELLOW}停止并移除旧容器...${NC}"
docker-compose down

# 重新构建并启动服务
echo -e "${YELLOW}重新构建并启动服务...${NC}"
docker-compose up -d --build

# 检查服务状态
echo -e "${YELLOW}检查服务状态...${NC}"
docker-compose ps

echo -e "${GREEN}更新完成！${NC}"
