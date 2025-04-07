const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const { createLogger, format, transports } = require('winston');
const { combine, timestamp, printf } = format;
const moment = require('moment');
const cors = require('cors');
const fetch = require('node-fetch');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
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
    new transports.File({ filename: 'logs/monitor-error.log', level: 'error' }),
    new transports.File({ filename: 'logs/monitor-combined.log' })
  ]
});

// 配置
const config = {
  port: process.env.PORT || 8080,
  streamsDir: process.env.STREAMS_DIR || '/app/streams',
  logsDir: process.env.LOGS_DIR || '/app/logs',
  streamServiceUrl: process.env.STREAM_SERVICE_URL || 'http://stream-service:3000'
};

// 创建Express应用
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// 中间件：记录请求
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});

// API路由

// 获取系统状态
app.get('/api/system-status', async (req, res) => {
  try {
    // 获取磁盘使用情况
    const disk = await getDiskUsage('/');

    // 获取内存使用情况
    const memoryUsage = process.memoryUsage();

    // 获取流服务状态
    let streamServiceStatus = 'unknown';
    let activeChannels = [];

    try {
      const response = await fetch(`${config.streamServiceUrl}/api/status`);
      if (response.ok) {
        const data = await response.json();
        streamServiceStatus = 'online';

        // 获取活跃频道
        const channelsResponse = await fetch(`${config.streamServiceUrl}/api/active-channels`);
        if (channelsResponse.ok) {
          activeChannels = await channelsResponse.json();
        }
      }
    } catch (err) {
      streamServiceStatus = 'offline';
      logger.error(`Error fetching stream service status: ${err.message}`);
    }

    // 获取日志文件列表
    const logFiles = await getLogFiles();

    // 返回状态信息
    res.json({
      timestamp: Date.now(),
      disk: {
        total: disk.total,
        free: disk.free,
        used: disk.total - disk.free,
        percent: ((disk.total - disk.free) / disk.total * 100).toFixed(2)
      },
      memory: {
        rss: memoryUsage.rss,
        heapTotal: memoryUsage.heapTotal,
        heapUsed: memoryUsage.heapUsed,
        external: memoryUsage.external
      },
      streamService: {
        status: streamServiceStatus,
        activeChannels: activeChannels
      },
      logs: logFiles
    });
  } catch (err) {
    logger.error(`Error getting system status: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// 获取日志内容
app.get('/api/logs/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(config.logsDir, filename);

    // 安全检查：确保文件在日志目录中
    if (!filePath.startsWith(config.logsDir)) {
      return res.status(403).send('Access denied');
    }

    // 检查文件是否存在
    if (!await fs.pathExists(filePath)) {
      return res.status(404).send('Log file not found');
    }

    // 读取文件内容
    const content = await fs.readFile(filePath, 'utf8');

    // 返回最后1000行
    const lines = content.split('\n');
    const lastLines = lines.slice(Math.max(0, lines.length - 1000)).join('\n');

    res.send(lastLines);
  } catch (err) {
    logger.error(`Error reading log file: ${err.message}`);
    res.status(500).send(`Error reading log file: ${err.message}`);
  }
});

// 获取频道统计信息
app.get('/api/channel-stats', async (req, res) => {
  try {
    // 获取活跃频道
    let activeChannels = [];

    try {
      const response = await fetch(`${config.streamServiceUrl}/api/active-channels`);
      if (response.ok) {
        activeChannels = await response.json();
      }
    } catch (err) {
      logger.error(`Error fetching active channels: ${err.message}`);
    }

    // 获取频道目录
    const channelDirs = await fs.readdir(config.streamsDir);

    // 收集频道统计信息
    const channelStats = [];

    for (const dir of channelDirs) {
      const channelDir = path.join(config.streamsDir, dir);
      const segmentsDir = path.join(channelDir, 'segments');

      // 检查是否是目录
      const stats = await fs.stat(channelDir);
      if (!stats.isDirectory()) continue;

      // 获取分片文件
      let segmentCount = 0;
      let totalSize = 0;

      if (await fs.pathExists(segmentsDir)) {
        const files = await fs.readdir(segmentsDir);
        const tsFiles = files.filter(file => file.endsWith('.ts'));
        segmentCount = tsFiles.length;

        // 计算总大小
        for (const file of tsFiles) {
          const fileStats = await fs.stat(path.join(segmentsDir, file));
          totalSize += fileStats.size;
        }
      }

      // 查找活跃信息
      const activeInfo = activeChannels.find(ch => ch.channelId === dir);

      channelStats.push({
        channelId: dir,
        isActive: !!activeInfo,
        clientCount: activeInfo ? activeInfo.clientCount : 0,
        startTime: activeInfo ? activeInfo.startTime : null,
        lastActivity: activeInfo ? activeInfo.lastActivity : null,
        segmentCount,
        totalSize,
        lastModified: stats.mtime
      });
    }

    res.json(channelStats);
  } catch (err) {
    logger.error(`Error getting channel stats: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// 辅助函数：获取日志文件列表
async function getLogFiles() {
  try {
    const files = await fs.readdir(config.logsDir);
    const logFiles = [];

    for (const file of files) {
      if (file.endsWith('.log')) {
        const filePath = path.join(config.logsDir, file);
        const stats = await fs.stat(filePath);

        logFiles.push({
          name: file,
          size: stats.size,
          modified: stats.mtime
        });
      }
    }

    return logFiles;
  } catch (err) {
    logger.error(`Error reading log files: ${err.message}`);
    return [];
  }
}

// 获取磁盘使用情况
async function getDiskUsage(path) {
  try {
    // 使用df命令获取磁盘使用情况
    const { stdout } = await execPromise('df -k ' + path);

    // 解析输出
    const lines = stdout.trim().split('\n');
    const parts = lines[1].split(/\s+/);

    // 计算磁盘使用情况
    const total = parseInt(parts[1]) * 1024; // 转换为字节
    const used = parseInt(parts[2]) * 1024;
    const free = parseInt(parts[3]) * 1024;

    return { total, free, used };
  } catch (err) {
    logger.error(`Error getting disk usage: ${err.message}`);
    // 返回默认值
    return { total: 0, free: 0, used: 0 };
  }
}

// 主页路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 监控页面路由
app.get('/monitor', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 启动服务器
app.listen(config.port, () => {
  logger.info(`Monitor service listening on port ${config.port}`);
});
