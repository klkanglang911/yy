/**
 * 生成访问令牌的脚本
 * 
 * 使用方法：
 * node generate_token.js [过期时间]
 * 
 * 过期时间格式：
 * - 数字：表示天数，例如 7 表示7天
 * - 字符串：例如 '60m'（60分钟）, '24h'（24小时）, '7d'（7天）
 * - 默认：7天
 */

const jwt = require('jsonwebtoken');
require('dotenv').config();

// 获取密钥
const secret = process.env.TOKEN_SECRET;

if (!secret) {
  console.error('错误: TOKEN_SECRET未在.env文件中设置');
  process.exit(1);
}

// 获取过期时间参数
let expiresIn = '7d'; // 默认7天
if (process.argv.length > 2) {
  const arg = process.argv[2];
  if (!isNaN(arg)) {
    // 如果是数字，视为天数
    expiresIn = `${arg}d`;
  } else {
    // 否则直接使用参数
    expiresIn = arg;
  }
}

// 生成令牌
const token = jwt.sign({}, secret, { expiresIn });

console.log('访问令牌已生成:');
console.log(token);
console.log(`\n此令牌将在 ${expiresIn} 后过期`);
console.log('\n使用方法:');
console.log('将此令牌添加到URL中作为token参数:');
console.log('http://your-server-ip/channel/{youtube-channel-id}/playlist.m3u8?token=' + token);
