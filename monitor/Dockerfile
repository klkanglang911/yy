FROM node:16-alpine

# 创建app目录
WORKDIR /app

# 安装依赖
COPY package*.json ./
RUN npm install

# 复制源代码
COPY . .

# 创建必要的目录
RUN mkdir -p /app/logs

# 暴露端口
EXPOSE 8080

# 启动应用
CMD ["npm", "start"]
