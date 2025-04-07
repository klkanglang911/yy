const express = require('express');
const cors = require('cors');
const { createLogger, format, transports } = require('winston');
const { combine, timestamp, printf } = format;
const fs = require('fs-extra');
const path = require('path');
const jwt = require('jsonwebtoken');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const { spawn } = require('child_process');
require('dotenv').config();

// 创建日志记录器
const logFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} ${level}: ${message}`;
});

const logger = createLogger({
  format: combine(
    timestamp(),
    logFormat
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: 'logs/error.log', level: 'error' }),
    new transports.File({ filename: 'logs/combined.log' })
  ]
});

// 配置
const config = {
  port: process.env.PORT || 3000,
  streamsDir: process.env.STREAMS_DIR || '/app/streams',
  tokenSecret: process.env.TOKEN_SECRET || 'your-secret-key',
  youtubeApiKey: process.env.YOUTUBE_API_KEY,
  maxQuality: process.env.MAX_QUALITY === 'true',
  bufferSize: parseInt(process.env.BUFFER_SIZE || '120'),
  segmentDuration: 10, // 分片时长（秒）
  maxInactiveTime: 30, // 无活跃连接后关闭流的时间（秒）
  cleanupInterval: 3600, // 清理缓存的间隔（秒）
};

// 活跃频道管理
const activeChannels = new Map();

// 创建Express应用
const app = express();
app.use(cors());
app.use(express.json());

// 确保目录存在
fs.ensureDirSync(config.streamsDir);

// 中间件：记录请求
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});

// API路由

// 验证token
app.get('/api/validate-token', (req, res) => {
  const token = req.query.token;
  
  // 如果没有设置TOKEN_SECRET，则不验证token
  if (!process.env.TOKEN_SECRET) {
    return res.status(200).send('Token validation skipped');
  }
  
  if (!token) {
    return res.status(401).send('No token provided');
  }
  
  try {
    jwt.verify(token, config.tokenSecret);
    res.status(200).send('Token valid');
  } catch (err) {
    logger.error(`Invalid token: ${err.message}`);
    res.status(401).send('Invalid token');
  }
});

// 启动流
app.get('/api/start-stream', async (req, res) => {
  const channelId = req.headers['x-channel-id'];
  const clientIp = req.headers['x-real-ip'] || req.ip;
  
  if (!channelId) {
    return res.status(400).send('Channel ID is required');
  }
  
  try {
    // 检查频道是否已经活跃
    if (!activeChannels.has(channelId)) {
      logger.info(`Starting stream for channel ${channelId} requested by ${clientIp}`);
      
      // 创建频道目录
      const channelDir = path.join(config.streamsDir, channelId);
      const segmentsDir = path.join(channelDir, 'segments');
      await fs.ensureDir(segmentsDir);
      
      // 启动流处理
      startStreamProcess(channelId);
      
      // 添加到活跃频道
      activeChannels.set(channelId, {
        clients: new Set([clientIp]),
        lastActivity: Date.now(),
        startTime: Date.now()
      });
    } else {
      // 更新现有频道信息
      const channelInfo = activeChannels.get(channelId);
      channelInfo.clients.add(clientIp);
      channelInfo.lastActivity = Date.now();
      
      // 如果有关闭计时器，取消它
      if (channelInfo.shutdownTimer) {
        clearTimeout(channelInfo.shutdownTimer);
        delete channelInfo.shutdownTimer;
        logger.info(`Cancelled shutdown for channel ${channelId}`);
      }
    }
    
    res.status(200).send('Stream started');
  } catch (err) {
    logger.error(`Error starting stream for channel ${channelId}: ${err.message}`);
    res.status(500).send(`Error starting stream: ${err.message}`);
  }
});

// 保持连接活跃
app.get('/api/keep-alive', (req, res) => {
  const channelId = req.headers['x-channel-id'];
  const clientIp = req.headers['x-real-ip'] || req.ip;
  
  if (!channelId) {
    return res.status(400).send('Channel ID is required');
  }
  
  if (activeChannels.has(channelId)) {
    const channelInfo = activeChannels.get(channelId);
    channelInfo.clients.add(clientIp);
    channelInfo.lastActivity = Date.now();
  }
  
  res.status(200).send('Connection kept alive');
});

// 获取活跃频道列表
app.get('/api/active-channels', (req, res) => {
  const channelsInfo = [];
  
  for (const [channelId, info] of activeChannels.entries()) {
    channelsInfo.push({
      channelId,
      clientCount: info.clients.size,
      startTime: info.startTime,
      lastActivity: info.lastActivity
    });
  }
  
  res.json(channelsInfo);
});

// 获取系统状态
app.get('/api/status', (req, res) => {
  res.json({
    activeChannels: activeChannels.size,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    config: {
      maxQuality: config.maxQuality,
      bufferSize: config.bufferSize,
      segmentDuration: config.segmentDuration
    }
  });
});

// 启动服务器
app.listen(config.port, () => {
  logger.info(`Stream service listening on port ${config.port}`);
});

// 流处理函数
async function startStreamProcess(channelId) {
  try {
    const channelDir = path.join(config.streamsDir, channelId);
    const segmentsDir = path.join(channelDir, 'segments');
    const playlistPath = path.join(channelDir, 'playlist.m3u8');
    
    // 确保目录存在
    await fs.ensureDir(segmentsDir);
    
    // 获取YouTube直播URL
    logger.info(`Fetching YouTube stream URL for channel ${channelId}`);
    const videoUrl = `https://www.youtube.com/watch?v=${channelId}`;
    
    // 使用ytdl获取最高质量的流
    const info = await ytdl.getInfo(videoUrl);
    const format = ytdl.chooseFormat(info.formats, { 
      quality: config.maxQuality ? 'highest' : 'highestvideo',
      filter: 'videoandaudio'
    });
    
    if (!format) {
      throw new Error('No suitable format found');
    }
    
    logger.info(`Selected format: ${format.qualityLabel} (${format.container})`);
    
    // 创建HLS流
    const stream = ytdl(videoUrl, { format: format });
    
    // 使用ffmpeg处理流
    const ffmpegProcess = ffmpeg(stream)
      .outputOptions([
        '-c:v copy',              // 复制视频流，不重新编码
        '-c:a copy',              // 复制音频流，不重新编码
        '-f hls',                 // HLS格式
        `-hls_time ${config.segmentDuration}`,  // 分片时长
        `-hls_list_size ${Math.ceil(config.bufferSize / config.segmentDuration)}`,  // 播放列表长度
        '-hls_flags delete_segments',  // 删除旧分片
        '-hls_segment_filename', `${segmentsDir}/%03d.ts`  // 分片文件名格式
      ])
      .output(playlistPath)
      .on('start', (commandLine) => {
        logger.info(`FFmpeg started with command: ${commandLine}`);
      })
      .on('error', (err) => {
        logger.error(`FFmpeg error for channel ${channelId}: ${err.message}`);
        // 尝试重启流
        setTimeout(() => {
          if (activeChannels.has(channelId) && activeChannels.get(channelId).clients.size > 0) {
            logger.info(`Attempting to restart stream for channel ${channelId}`);
            startStreamProcess(channelId);
          }
        }, 5000);
      })
      .on('end', () => {
        logger.info(`FFmpeg process ended for channel ${channelId}`);
      });
    
    // 启动ffmpeg进程
    ffmpegProcess.run();
    
    // 保存进程引用以便后续管理
    if (activeChannels.has(channelId)) {
      activeChannels.get(channelId).ffmpegProcess = ffmpegProcess;
    }
    
    // 创建初始M3U8播放列表文件（如果ffmpeg尚未创建）
    const initialPlaylist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:${config.segmentDuration}
#EXT-X-MEDIA-SEQUENCE:0
`;
    
    if (!fs.existsSync(playlistPath)) {
      await fs.writeFile(playlistPath, initialPlaylist);
    }
    
    logger.info(`Stream process started for channel ${channelId}`);
    return true;
  } catch (err) {
    logger.error(`Failed to start stream for channel ${channelId}: ${err.message}`);
    return false;
  }
}

// 停止流处理
function stopStreamProcess(channelId) {
  if (activeChannels.has(channelId)) {
    const channelInfo = activeChannels.get(channelId);
    
    if (channelInfo.ffmpegProcess) {
      try {
        channelInfo.ffmpegProcess.kill('SIGKILL');
        logger.info(`Stopped ffmpeg process for channel ${channelId}`);
      } catch (err) {
        logger.error(`Error stopping ffmpeg process for channel ${channelId}: ${err.message}`);
      }
    }
    
    activeChannels.delete(channelId);
    logger.info(`Channel ${channelId} removed from active channels`);
  }
}

// 定期检查不活跃的频道
setInterval(() => {
  const now = Date.now();
  
  for (const [channelId, channelInfo] of activeChannels.entries()) {
    // 如果没有活跃客户端且没有设置关闭计时器
    if (channelInfo.clients.size === 0 && !channelInfo.shutdownTimer) {
      logger.info(`No active clients for channel ${channelId}, scheduling shutdown`);
      
      // 设置关闭计时器
      channelInfo.shutdownTimer = setTimeout(() => {
        logger.info(`Shutting down stream for channel ${channelId} due to inactivity`);
        stopStreamProcess(channelId);
      }, config.maxInactiveTime * 1000);
    }
    // 检查客户端活跃状态
    else if (channelInfo.clients.size > 0 && now - channelInfo.lastActivity > 300000) {
      // 5分钟没有活动，清理可能的僵尸连接
      logger.info(`Channel ${channelId} inactive for 5 minutes, checking connections`);
      channelInfo.clients.clear(); // 清除所有客户端
      channelInfo.lastActivity = now;
    }
  }
}, 10000); // 每10秒检查一次

// 定期清理缓存
setInterval(async () => {
  try {
    logger.info('Starting cache cleanup');
    
    const dirs = await fs.readdir(config.streamsDir);
    
    for (const dir of dirs) {
      const channelDir = path.join(config.streamsDir, dir);
      const segmentsDir = path.join(channelDir, 'segments');
      
      // 如果不是活跃频道，清理旧文件
      if (!activeChannels.has(dir)) {
        const stats = await fs.stat(channelDir);
        const ageInHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
        
        // 如果目录超过2小时未修改，删除它
        if (ageInHours > 2) {
          logger.info(`Removing old channel directory: ${channelDir}`);
          await fs.remove(channelDir);
        }
      }
      // 对于活跃频道，只保留最新的分片
      else if (await fs.pathExists(segmentsDir)) {
        const files = await fs.readdir(segmentsDir);
        const tsFiles = files.filter(file => file.endsWith('.ts')).sort();
        
        // 计算要保留的分片数量
        const keepCount = Math.ceil(config.bufferSize / config.segmentDuration);
        
        // 如果分片数量超过保留数量，删除旧分片
        if (tsFiles.length > keepCount) {
          const filesToRemove = tsFiles.slice(0, tsFiles.length - keepCount);
          
          for (const file of filesToRemove) {
            await fs.remove(path.join(segmentsDir, file));
          }
          
          logger.info(`Removed ${filesToRemove.length} old segments for channel ${dir}`);
        }
      }
    }
    
    logger.info('Cache cleanup completed');
  } catch (err) {
    logger.error(`Error during cache cleanup: ${err.message}`);
  }
}, config.cleanupInterval * 1000);

// 优雅关闭
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  // 停止所有活跃流
  for (const [channelId, _] of activeChannels.entries()) {
    stopStreamProcess(channelId);
  }
  
  // 延迟退出以允许日志写入
  setTimeout(() => {
    process.exit(0);
  }, 1000);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  
  // 停止所有活跃流
  for (const [channelId, _] of activeChannels.entries()) {
    stopStreamProcess(channelId);
  }
  
  // 延迟退出以允许日志写入
  setTimeout(() => {
    process.exit(0);
  }, 1000);
});

// 处理未捕获的异常
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.message}`);
  logger.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
