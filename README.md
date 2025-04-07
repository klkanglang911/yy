# YouTube直播流转发系统

这是一个用于转发YouTube直播流的系统，允许用户通过VLC播放器观看YouTube直播频道。系统使用Debian服务器作为中转站，提供M3U直播源格式的视频流。

## 特性

- **高质量视频流**：保持YouTube直播的最高分辨率
- **按需转发**：只在有用户请求时才获取和转发视频流
- **智能缓存**：缓存视频分片以确保流畅播放，自动清理过期缓存
- **安全认证**：支持基于token的访问控制
- **监控系统**：提供Web界面监控系统状态、活跃频道和资源使用情况
- **容器化部署**：使用Docker和Docker Compose简化部署和维护

## 系统要求

- Debian系统服务器
- 至少2GB内存
- 足够的带宽（建议1Gbps以上）
- Docker和Docker Compose

## 安装步骤

1. 克隆仓库：

```bash
git clone https://github.com/yourusername/youtube-stream-proxy.git
cd youtube-stream-proxy
```

2. 运行安装脚本：

```bash
chmod +x scripts/install.sh
sudo ./scripts/install.sh
```

3. 配置环境变量：

编辑`.env`文件，设置YouTube API密钥和其他配置：

```
YOUTUBE_API_KEY=your_youtube_api_key_here
TOKEN_SECRET=your_secret_key_here
MAX_QUALITY=true
BUFFER_SIZE=120
```

4. 启动服务：

```bash
docker-compose up -d
```

## 使用方法

### 获取直播流URL

直播流URL格式为：

```
http://your-server-ip/channel/{youtube-channel-id}/playlist.m3u8?token={access-token}
```

其中：
- `{youtube-channel-id}` 是YouTube视频ID
- `{access-token}` 是可选的访问令牌（如果启用了token认证）

### 在VLC中使用

1. 打开VLC播放器
2. 点击"媒体" > "打开网络串流"
3. 输入直播流URL
4. 点击"播放"

### 生成访问令牌

如果启用了token认证，可以使用以下命令生成令牌：

```bash
docker-compose exec stream-service node -e "console.log(require('jsonwebtoken').sign({}, process.env.TOKEN_SECRET, {expiresIn: '7d'}))"
```

## 监控系统

访问 `http://your-server-ip/monitor` 查看监控界面，包括：

- 系统资源使用情况
- 活跃频道列表
- 缓存状态
- 日志查看

## 维护

### 更新系统

```bash
chmod +x scripts/update.sh
sudo ./scripts/update.sh
```

### 手动清理缓存

```bash
chmod +x scripts/cleanup.sh
./scripts/cleanup.sh
```

## 故障排除

### 查看日志

```bash
# 查看所有服务的日志
docker-compose logs

# 查看特定服务的日志
docker-compose logs nginx
docker-compose logs stream-service
docker-compose logs monitor
```

### 常见问题

1. **无法获取直播流**
   - 检查YouTube API密钥是否正确
   - 确认YouTube频道ID是否有效
   - 查看stream-service日志获取详细错误信息

2. **播放卡顿**
   - 增加缓冲区大小（修改.env中的BUFFER_SIZE）
   - 检查服务器带宽是否足够
   - 确保服务器CPU和内存资源充足

3. **监控页面无法访问**
   - 检查防火墙设置，确保80端口开放
   - 查看nginx日志获取详细错误信息

## 许可证

[MIT License](LICENSE)
