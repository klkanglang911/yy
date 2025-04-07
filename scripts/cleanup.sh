#!/bin/bash

# YouTube直播流转发系统缓存清理脚本

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# 设置缓存目录
CACHE_DIR="./data/streams"
LOG_DIR="./data/logs"

echo -e "${GREEN}开始清理缓存...${NC}"

# 清理流缓存
if [ -d "$CACHE_DIR" ]; then
  echo -e "${YELLOW}清理流缓存目录...${NC}"
  find "$CACHE_DIR" -type f -name "*.ts" -mtime +1 -delete
  echo -e "${GREEN}流缓存清理完成${NC}"
else
  echo -e "${RED}缓存目录不存在: $CACHE_DIR${NC}"
fi

# 清理旧日志
if [ -d "$LOG_DIR" ]; then
  echo -e "${YELLOW}清理旧日志文件...${NC}"
  find "$LOG_DIR" -type f -name "*.log" -mtime +7 -delete
  echo -e "${GREEN}日志清理完成${NC}"
else
  echo -e "${RED}日志目录不存在: $LOG_DIR${NC}"
fi

echo -e "${GREEN}缓存清理完成！${NC}"
