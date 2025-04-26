//===========配置常量=============
const AUTH_USERNAME = 'admin';//管理员账户
const AUTH_PASSWORD_HASH = '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918';//管理员密码(sha256):admin
const SESSION_DURATION = 15 * 60 * 1000; // 会话有效时长(15min)
const LOCK_DURATION = 15 * 60 * 1000; // 单次锁定时长(15min)
const MAX_FAILED_ATTEMPTS = 10;// 登录最大尝试次数
//================================
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});
async function handleRequest(request) {
  try {
    const url = new URL(request.url);

    // 登录页面
    if (url.pathname === "/login") {
      return handleLoginRequest(request);
    }

    // 登出
    if (url.pathname === "/logout") {
      return handleLogout(request);
    }

    // 检查会话
    const sessionValid = await checkSession(request);
    
    // 管理员界面 - 需要登录
    if (url.pathname.startsWith("/admin")) {
      if (!sessionValid) {
        return redirectToLogin(url);
      }
      return handleAdminRequest(request);
    }

    // 主页面 - 显示所有配置（不需要登录）
    if (url.pathname === "/") {
      return handleHomePage(request);
    }

    // 检查是否有匹配的路径映射
    const pathMappings = await CONFIG_KV.get('path_mappings', 'json') || {};
    let actualUrlStr = null;
    let matchedPrefix = null;

    // 查找匹配的路径映射
    for (const [prefix, target] of Object.entries(pathMappings)) {
      if (url.pathname.startsWith(`/${prefix}/`)) {
        const restPath = url.pathname.slice(prefix.length + 2); // +2 去掉前缀和斜杠
        actualUrlStr = `${target.endsWith('/') ? target.slice(0, -1) : target}/${restPath}${url.search}`;
        matchedPrefix = prefix;
        break;
      }
    }

    // 如果没有匹配的映射，返回404
    if (!actualUrlStr) {
      return new Response("未找到匹配的路径映射", { status: 404 });
    }

    // 创建新 Headers 对象，保留原始Host头
    const newHeaders = new Headers();
    for (const [name, value] of request.headers) {
      if (!name.startsWith('cf-') && name.toLowerCase() !== 'cf-connecting-ip') {
        newHeaders.set(name, value);
      }
    }

    // 设置正确的Host头
    const targetHost = new URL(actualUrlStr).hostname;
    newHeaders.set('Host', targetHost);

    // 创建一个新的请求以访问目标 URL
    const modifiedRequest = new Request(actualUrlStr, {
      method: request.method,
      headers: newHeaders,
      body: request.body,
      redirect: 'manual'
    });

    // 发起对目标 URL 的请求
    const response = await fetch(modifiedRequest);
    let body = response.body;

    // 处理重定向 - 新增重定向目标检查
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (location) {
        // 检查重定向目标是否在允许的映射中
        const isAllowed = await isRedirectAllowed(location, pathMappings);
        if (!isAllowed) {
          return new Response("不允许的重定向目标", { status: 403 });
        }

        // 将重定向URL转换为我们的代理URL
        const locationUrl = new URL(location, actualUrlStr);
        const newLocation = `/${matchedPrefix}/${encodeURIComponent(locationUrl.toString().replace(pathMappings[matchedPrefix], ''))}`;
        
        const newResponseHeaders = new Headers(response.headers);
        newResponseHeaders.set('location', newLocation);
        
        return new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: newResponseHeaders
        });
      }
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    }

    // 根据 Content-Type 处理不同类型的响应内容
    const contentType = response.headers.get("Content-Type") || "";
    if (contentType.includes("text/html")) {
      body = await handleHtmlContent(response, url.protocol, url.host, actualUrlStr, matchedPrefix, pathMappings[matchedPrefix]);
    } else if (contentType.includes("text/plain") || contentType.includes("text/css") || contentType.includes("text/javascript")) {
      body = await handleTextContent(response);
    } else if (contentType.includes("application/json")) {
      body = await handleJsonContent(response);
    } else {
      body = response.body;
    }

    // 创建修改后的响应对象
    const bodyStream = typeof body === 'string' ? new Response(body).body : body;

    // 创建新的 headers 对象并添加自定义头
    const modifiedHeaders = new Headers(response.headers);
    setNoCacheHeaders(modifiedHeaders);
    setCorsHeaders(modifiedHeaders);

    return new Response(bodyStream, {
      status: response.status,
      statusText: response.statusText,
      headers: modifiedHeaders
    });
  } catch (error) {
    return jsonResponse({
      error: error.message
    }, 500);
  }
}

// 检查重定向目标是否在允许的映射中
async function isRedirectAllowed(location, pathMappings) {
  try {
    const locationUrl = new URL(location);
    for (const target of Object.values(pathMappings)) {
      const targetUrl = new URL(target);
      if (locationUrl.hostname === targetUrl.hostname) {
        return true;
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}

// 处理主页请求 - 显示所有配置
async function handleHomePage(request) {
  const pathMappings = await CONFIG_KV.get('path_mappings', 'json') || {};
  
  let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/css/materialize.min.css" rel="stylesheet">
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
  <title>代理服务配置列表</title>
  <style>
    body {
      font-family: 'Roboto', sans-serif;
      background-color: #f5f5f5;
      padding-top: 20px;
    }
    .card {
      border-radius: 8px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.1);
      margin-bottom: 20px;
    }
    .header-container {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 15px;
    }
    .mapping-item {
      padding: 15px;
      border-bottom: 1px solid #eee;
      transition: background-color 0.3s;
    }
    .mapping-item:hover {
      background-color: #f9f9f9;
    }
    .mapping-prefix {
      font-weight: 500;
      color: #2196F3;
    }
    .mapping-target {
      color: #666;
    }
    .login-btn {
      margin-top: 5px;
    }
    @media (max-width: 600px) {
      .container {
        padding: 0 15px;
      }
      .header-container {
        flex-direction: column;
        align-items: flex-start;
      }
      .login-btn {
        margin: 10px 0;
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="card-content">
        <div class="header-container">
          <h4>代理服务配置列表</h4>
          <a href="/login" class="btn waves-effect waves-light blue login-btn">
            <i class="material-icons left">login</i>管理员登录
          </a>
        </div>
        
        <div class="divider"></div>
        
        <div class="section">
          <h6>当前配置的路径映射：</h6>
          <div id="mappings-container">`;
  
  if (Object.keys(pathMappings).length === 0) {
    html += '<p class="grey-text">暂无映射配置</p>';
  } else {
    for (const [prefix, target] of Object.entries(pathMappings)) {
      html += `
            <div class="mapping-item">
              <div class="row" style="margin-bottom: 0;">
                <div class="col s12 m4">
                  <span class="mapping-prefix">/${prefix}/*</span>
                </div>
                <div class="col s12 m8">
                  <span class="mapping-target">→ ${target}/*</span>
                </div>
              </div>
            </div>`;
    }
  }
  
  html += `
          </div>
        </div>
      </div>
    </div>
  </div>
  
  <script src="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/js/materialize.min.js"></script>
</body>
</html>`;
  
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8'
    }
  });
}

// 处理登录请求
async function handleLoginRequest(request) {
  const url = new URL(request.url);
  
  // 检查是否已锁定
  const lockInfo = await AUTH_KV.get('login_lock');
  if (lockInfo) {
    const lockTime = parseInt(lockInfo);
    if (Date.now() - lockTime < LOCK_DURATION) {
      return new Response("登录功能已锁定，请15分钟后再试", { 
        status: 403,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    } else {
      await AUTH_KV.delete('login_lock');
      await AUTH_KV.delete('failed_attempts');
    }
  }
  
  // GET请求显示登录页面
  if (request.method === 'GET') {
    return new Response(getLoginHtml(), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8'
      }
    });
  }
  
  // POST请求处理登录
  if (request.method === 'POST') {
    const formData = await request.formData();
    const username = formData.get('username');
    const password = formData.get('password');
    
    // 计算密码的SHA256哈希
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const passwordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    if (username === AUTH_USERNAME && passwordHash === AUTH_PASSWORD_HASH) {
      // 登录成功，创建会话
      const sessionId = generateSessionId();
      await AUTH_KV.put(`session_${sessionId}`, Date.now().toString(), { expirationTtl: SESSION_DURATION / 1000 });
      await AUTH_KV.delete('failed_attempts'); // 清除失败计数
      
      // 设置Cookie
      const headers = new Headers();
      headers.append('Location', '/admin');
      headers.append('Set-Cookie', `session=${sessionId}; Path=/; HttpOnly; Max-Age=${SESSION_DURATION / 1000}`);
      return new Response(null, {
        status: 302,
        headers: headers
      });
    } else {
      // 登录失败，增加失败计数
      const failedAttempts = parseInt(await AUTH_KV.get('failed_attempts') || '0') + 1;
      await AUTH_KV.put('failed_attempts', failedAttempts.toString());
      
      // 如果超过最大尝试次数，锁定
      if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
        await AUTH_KV.put('login_lock', Date.now().toString());
        return new Response("登录失败次数过多，功能已锁定15分钟", { 
          status: 403,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
      
      return new Response("用户名或密码错误", { 
        status: 401,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  }
  
  return new Response("Method not allowed", { status: 405 });
}

// 处理登出请求
async function handleLogout(request) {
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const sessionId = cookies.session;
  
  if (sessionId) {
    await AUTH_KV.delete(`session_${sessionId}`);
  }
  
  const headers = new Headers();
  headers.append('Location', '/');
  headers.append('Set-Cookie', 'session=; Path=/; HttpOnly; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  return new Response(null, {
    status: 302,
    headers: headers
  });
}

// 检查会话是否有效
async function checkSession(request) {
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const sessionId = cookies.session;
  
  if (!sessionId) return false;
  
  const sessionTime = await AUTH_KV.get(`session_${sessionId}`);
  if (!sessionTime) return false;
  
  // 更新会话有效期
  await AUTH_KV.put(`session_${sessionId}`, Date.now().toString(), { expirationTtl: SESSION_DURATION / 1000 });
  return true;
}

// 生成随机会话ID
function generateSessionId() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

// 解析Cookie
function parseCookies(cookieHeader) {
  return cookieHeader.split(';').reduce((cookies, cookie) => {
    const [name, value] = cookie.split('=').map(c => c.trim());
    cookies[name] = value;
    return cookies;
  }, {});
}

// 重定向到登录页面
function redirectToLogin(url) {
  const headers = new Headers();
  headers.append('Location', `/login?redirect=${encodeURIComponent(url.pathname)}`);
  return new Response(null, {
    status: 302,
    headers: headers
  });
}

// 登录页面HTML
function getLoginHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/css/materialize.min.css" rel="stylesheet">
  <title>管理员登录</title>
  <style>
    body {display: flex;min-height: 100vh;flex-direction: column;background-color: #f5f5f5;}
    .login-container {flex: 1;display: flex;align-items: center;}
    .login-card {width: 100%;max-width: 400px;margin: 0 auto;border-radius: 8px;overflow: hidden;}
    .card-title {text-align: center;font-weight: 500;}
    .input-field label {color: #9e9e9e;}
    .input-field input:focus + label {color: #2196f3 !important;}
    .input-field input:focus {border-bottom: 1px solid #2196f3 !important;box-shadow: 0 1px 0 0 #2196f3 !important;}
    .btn-block {width: 100%;}
    .back-link {display: block;text-align: center;margin-top: 15px;}
    .error-message {color: #f44336;text-align: center;margin-top: 10px;}
  </style>
</head>
<body>
  <div class="login-container">
    <div class="container">
      <div class="row">
        <div class="col s12">
          <div class="card login-card">
            <div class="card-content">
              <span class="card-title">管理员登录</span>
              <form method="POST" action="/login">
                <div class="row">
                  <div class="input-field col s12">
                    <input id="username" type="text" name="username" required>
                    <label for="username">用户名</label>
                  </div>
                  <div class="input-field col s12">
                    <input id="password" type="password" name="password" required>
                    <label for="password">密码</label>
                  </div>
                </div>
                <button type="submit" class="btn waves-effect waves-light blue btn-block">登录</button>
                <a href="/" class="back-link">返回首页</a>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/js/materialize.min.js"></script>
</body>
</html>`;
}

// 处理管理员请求
async function handleAdminRequest(request) {
  const url = new URL(request.url);
  
  // 如果是GET请求，返回管理页面
  if (request.method === 'GET') {
    return new Response(getAdminHtml(), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8'
      }
    });
  }
  
  // 如果是POST请求，处理配置更新
  if (request.method === 'POST') {
    const formData = await request.formData();
    const action = formData.get('action');
    
    if (action === 'get_mappings') {
      const mappings = await CONFIG_KV.get('path_mappings', 'json') || {};
      return jsonResponse(mappings);
    }
    
    if (action === 'add_mapping') {
      const prefix = formData.get('prefix');
      const target = formData.get('target');
      
      if (!prefix || !target) {
        return jsonResponse({ error: '前缀和目标不能为空' }, 400);
      }
      
      try {
        new URL(target);
      } catch (e) {
        return jsonResponse({ error: '目标URL格式不正确' }, 400);
      }
      
      const mappings = await CONFIG_KV.get('path_mappings', 'json') || {};
      mappings[prefix] = target.endsWith('/') ? target.slice(0, -1) : target;
      await CONFIG_KV.put('path_mappings', JSON.stringify(mappings));
      return jsonResponse({ success: true });
    }
    
    if (action === 'delete_mapping') {
      const prefix = formData.get('prefix');
      
      if (!prefix) {
        return jsonResponse({ error: '前缀不能为空' }, 400);
      }
      
      const mappings = await CONFIG_KV.get('path_mappings', 'json') || {};
      delete mappings[prefix];
      await CONFIG_KV.put('path_mappings', JSON.stringify(mappings));
      return jsonResponse({ success: true });
    }
  }
  
  return new Response('Not Found', { status: 404 });
}

// 处理 HTML 内容中的相对路径
async function handleHtmlContent(response, protocol, host, actualUrlStr, prefix, target) {
  const originalText = await response.text();
  const baseUrl = new URL(actualUrlStr);
  
  let modifiedText = originalText
    .replace(/(href|src|action)=["']\/(?!\/)/g, `$1="/${prefix}/`)
    .replace(/(href|src|action)=["'](\.\/)/g, `$1="/${prefix}/${baseUrl.pathname.split('/').slice(0, -1).join('/')}/`)
    .replace(/(href|src|action)=["'](?!https?:\/\/)([^"']+)/g, `$1="/${prefix}/${baseUrl.pathname.split('/').slice(0, -1).join('/')}/$2`);
  
  if (target) {
    modifiedText = modifiedText.replace(new RegExp(target, 'g'), `/${prefix}`);
  }
  
  return modifiedText;
}

// 处理文本内容
async function handleTextContent(response) {
  const originalText = await response.text();
  return originalText;
}

// 处理 JSON 内容
async function handleJsonContent(response) {
  const originalJson = await response.json();
  return JSON.stringify(originalJson);
}

// 返回 JSON 格式的响应
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

// 设置禁用缓存的头部
function setNoCacheHeaders(headers) {
  const noCacheHeaders = new Headers(headers);
  noCacheHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  noCacheHeaders.set('Pragma', 'no-cache');
  noCacheHeaders.set('Expires', '0');
  return noCacheHeaders;
}

// 设置 CORS 头部
function setCorsHeaders(headers) {
  const corsHeaders = new Headers(headers);
  corsHeaders.set('Access-Control-Allow-Origin', '*');
  corsHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  corsHeaders.set('Access-Control-Allow-Headers', '*');
  return corsHeaders;
}

// 返回管理员界面的 HTML
function getAdminHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/css/materialize.min.css" rel="stylesheet">
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
  <title>路径映射管理</title>
  <style>
    body {
      font-family: 'Roboto', sans-serif;
      background-color: #f5f5f5;
    }
    .header-container {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }
    .card {
      border-radius: 8px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.1);
      margin-bottom: 20px;
    }
    .mapping-item {
      padding: 15px;
      border-bottom: 1px solid #eee;
      transition: background-color 0.3s;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .mapping-item:hover {
      background-color: #f9f9f9;
    }
    .mapping-prefix {
      font-weight: 500;
      color: #2196F3;
    }
    .mapping-target {
      color: #666;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .delete-btn {
      color: #f44336;
      cursor: pointer;
      margin-left: 10px;
    }
    .add-mapping-form {
      margin-bottom: 30px;
    }
    .logout-link {
      margin-left: 15px;
    }
    .loading-text {
      text-align: center;
      color: #9e9e9e;
      padding: 20px;
    }
    @media (max-width: 600px) {
      .header-container {
        flex-direction: column;
        align-items: flex-start;
      }
      .logout-link {
        margin: 10px 0 0 0;
        width: 100%;
      }
      .mapping-item {
        flex-direction: column;
        align-items: flex-start;
      }
      .mapping-actions {
        margin-top: 10px;
        align-self: flex-end;
      }
      .input-field {
        margin-bottom: 10px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="section">
      <div class="header-container">
        <h4>路径映射管理</h4>
        <a href="/logout" class="btn waves-effect waves-light blue logout-btn">
          <i class="material-icons left">exit_to_app</i>退出登录
        </a>
      </div>
      
      <div class="card add-mapping-form">
        <div class="card-content">
          <span class="card-title">添加新映射</span>
          <div class="row">
            <div class="input-field col s12 m5">
              <input id="prefix" type="text" required placeholder="如: jsdelivr">
              <label for="prefix">路径前缀</label>
            </div>
            <div class="input-field col s12 m5">
              <input id="target" type="text" required placeholder="如: https://cdn.jsdelivr.net">
              <label for="target">目标URL</label>
            </div>
            <div class="col s12 m2">
              <button id="addBtn" class="btn waves-effect waves-light blue" style="width: 100%;">
                <i class="material-icons left">add</i>添加
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <div class="card">
        <div class="card-content">
          <span class="card-title">当前映射</span>
          <div id="mappingsList">
            <p class="loading-text">正在加载映射配置...</p>
          </div>
        </div>
      </div>
    </div>
  </div>
  
  <script src="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/js/materialize.min.js"></script>
  <script>
    document.addEventListener('DOMContentLoaded', function() {
      // 初始化Materialize组件
      M.AutoInit();
      
      loadMappings();
      
      document.getElementById('addBtn').addEventListener('click', addMapping);
    });
    
    async function loadMappings() {
      try {
        const mappingsList = document.getElementById('mappingsList');
        mappingsList.innerHTML = '<p class="loading-text">正在加载映射配置...</p>';
        
        const response = await fetch('/admin', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'action=get_mappings'
        });
        
        const data = await response.json();
        mappingsList.innerHTML = '';
        
        if (Object.keys(data).length === 0) {
          mappingsList.innerHTML = '<p class="grey-text center-align">暂无映射配置</p>';
          return;
        }
        
        for (const [prefix, target] of Object.entries(data)) {
          const item = document.createElement('div');
          item.className = 'mapping-item';
          item.innerHTML = \`
            <div class="mapping-info">
              <span class="mapping-prefix">/\${prefix}/*</span>
              <span class="mapping-target">→ \${target}/*</span>
            </div>
            <div class="mapping-actions">
              <span class="delete-btn" data-prefix="\${prefix}">
                <i class="material-icons">delete</i>
              </span>
            </div>
          \`;
          mappingsList.appendChild(item);
        }
        
        document.querySelectorAll('.delete-btn').forEach(btn => {
          btn.addEventListener('click', deleteMapping);
        });
      } catch (error) {
        document.getElementById('mappingsList').innerHTML = 
          '<p class="red-text center-align">加载映射失败: ' + error.message + '</p>';
        console.error('加载映射失败:', error);
      }
    }
    
    async function addMapping() {
      const prefix = document.getElementById('prefix').value.trim();
      const target = document.getElementById('target').value.trim();
      
      if (!prefix || !target) {
        M.toast({html: '请填写完整信息', classes: 'red'});
        return;
      }
      
      try {
        new URL(target);
      } catch (e) {
        M.toast({html: '目标URL格式不正确', classes: 'red'});
        return;
      }
      
      try {
        const formData = new FormData();
        formData.append('action', 'add_mapping');
        formData.append('prefix', prefix);
        formData.append('target', target);
        
        const response = await fetch('/admin', {
          method: 'POST',
          body: formData
        });
        
        const result = await response.json();
        if (result.success) {
          document.getElementById('prefix').value = '';
          document.getElementById('target').value = '';
          M.toast({html: '添加成功', classes: 'green'});
          loadMappings();
        } else {
          M.toast({html: '添加失败: ' + (result.error || ''), classes: 'red'});
        }
      } catch (error) {
        M.toast({html: '添加映射失败: ' + error.message, classes: 'red'});
        console.error('添加映射失败:', error);
      }
    }
    
    async function deleteMapping(event) {
      const prefix = event.currentTarget.getAttribute('data-prefix');
      
      if (!confirm(\`确定要删除 /\${prefix}/* 的映射吗？\`)) {
        return;
      }
      
      try {
        const formData = new FormData();
        formData.append('action', 'delete_mapping');
        formData.append('prefix', prefix);
        
        const response = await fetch('/admin', {
          method: 'POST',
          body: formData
        });
        
        const result = await response.json();
        if (result.success) {
          M.toast({html: '删除成功', classes: 'green'});
          loadMappings();
        } else {
          M.toast({html: '删除失败: ' + (result.error || ''), classes: 'red'});
        }
      } catch (error) {
        M.toast({html: '删除映射失败: ' + error.message, classes: 'red'});
        console.error('删除映射失败:', error);
      }
    }
  </script>
</body>
</html>`;
}