# cf-pathProxy - Cloudflare 路径代理服务

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange)

一个基于 Cloudflare Workers 的轻量级路径代理服务，支持路径映射和基础认证管理。

## 功能特点

- 🛣️ 路径前缀映射到目标URL
- 🔐 管理员登录保护配置界面
- ⚡ 自动处理HTML/CSS/JS中的相对路径
- 📱 响应式管理界面

## 快速部署

### 准备工作

1. 在 Cloudflare 仪表板创建两个 KV 命名空间：
   - `CONFIG_KV` - 存储路径映射配置
   - `AUTH_KV` - 存储会话和认证信息

2. 将这两个KV命名空间绑定到Worker

[![部署到 Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/nibawei/cf-pathProxy)

### 手动部署

1. 复制 `worker.js` 内容
2. 在 Cloudflare Workers 控制台创建新Worker
3. 粘贴代码并保存

## 使用方法

1. 访问Worker域名查看现有映射
2. 使用默认账号登录管理界面：
   - 用户名: `admin`
   - 密码: `admin`

3. 在管理界面添加路径映射，例如：
   - 前缀: `jsdelivr`
   - 目标URL: `https://cdn.jsdelivr.net`

访问示例: `your-worker.dev/jsdelivr/npm/jquery` → 代理到 `cdn.jsdelivr.net/npm/jquery`

## 安全建议

⚠️ **重要**：部署后请立即修改默认密码！

1. 修改脚本开头的认证信息：
```javascript
const AUTH_USERNAME = '自定义用户名';
const AUTH_PASSWORD_HASH = '新密码的SHA256哈希值'; 
```

2. 可以使用在线工具生成SHA256哈希，或使用Node.js生成：
```bash
node -e "console.log(require('crypto').createHash('sha256').update('你的密码').digest('hex'))"
```

## 开源协议

MIT License