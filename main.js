const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const initSqlJs = require('sql.js');
const WebSocket = require('ws');

// WebSocket 客户端连接列表
let wsClients = [];

// 创建数据库连接
console.log('正在初始化SQL.js数据库...');
let db;
let SQL;

// 数据库文件路径
const dbPath = './calls.db';

// 监控scripts目录变化
function watchScriptsDirectory() {
  const scriptsDir = path.join(__dirname, 'scripts');
  
  console.log(`开始监控scripts目录: ${scriptsDir}`);
  
  // 确保目录存在
  if (!fs.existsSync(scriptsDir)) {
    fs.mkdirSync(scriptsDir, { recursive: true });
  }
  
  // 监控文件变化
  fs.watch(scriptsDir, { recursive: true }, async (eventType, filename) => {
    if (!filename) return;
    
    console.log(`检测到scripts目录变化: ${filename}, 事件类型: ${eventType}`);
    
    try {
      // 获取最新的模块列表
      const modules = await getAvailableModules();
      
      // 通知所有连接的WebSocket客户端
      wsClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'modules_updated',
            modules: modules
          }));
        }
      });
    } catch (err) {
      console.error('处理脚本变化时出错:', err);
    }
  });
}

// 异步初始化数据库
async function initDatabase() {
  try {
    SQL = await initSqlJs();
    
    // 检查数据库文件是否存在
    if (fs.existsSync(dbPath)) {
      const filebuffer = fs.readFileSync(dbPath);
      db = new SQL.Database(filebuffer);
      console.log('成功加载已有的SQL.js数据库');
    } else {
      // 创建新数据库
      db = new SQL.Database();
      console.log('创建新的SQL.js数据库');
      
      // 创建表
      db.run(`CREATE TABLE IF NOT EXISTS calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        call_string TEXT,
        result TEXT
      )`);
      
      // 保存数据库文件
      const data = db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(dbPath, buffer);
    }
  } catch (err) {
    console.error('初始化SQL.js数据库失败:', err.message);
    console.error('请确保已安装sql.js包');
    process.exit(1);
  }
}

// 清除require缓存，确保每次都重新加载最新的模块
function clearModuleCache(modulePath) {
  const resolvedPath = require.resolve(modulePath);
  delete require.cache[resolvedPath];
}

// 保存数据库文件的函数
function saveDatabase() {
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  } catch (err) {
    console.error('保存数据库文件失败:', err);
  }
}

// 保存记录到数据库的函数
async function saveToDatabase(callString, result) {
  return new Promise((resolve, reject) => {
    try {
      // 处理复杂对象，避免循环引用
      let resultStr;
      try {
        resultStr = JSON.stringify(result, (key, value) => {
          // 避免循环引用和函数等无法序列化的内容
          if (typeof value === 'function') {
            return '[Function]';
          }
          if (value instanceof Error) {
            return `[Error: ${value.message}]`;
          }
          if (typeof value === 'object' && value !== null) {
            // 避免循环引用
            const seen = new WeakSet();
            if (seen.has(value)) {
              return '[Circular]';
            }
            seen.add(value);
          }
          return value;
        }, 2);
      } catch (jsonError) {
        console.error('JSON序列化失败:', jsonError);
        // 简单转换为字符串
        resultStr = String(result);
      }
      
      console.log(`保存记录到数据库: ${callString}, 结果长度: ${resultStr.length}`);
      
      // 插入记录
      db.run('INSERT INTO calls (call_string, result) VALUES (?, ?)', 
        [callString, resultStr]);
      
      // 保存到文件
      saveDatabase();
      resolve();
    } catch (err) {
      console.error('保存到数据库失败:', err);
      reject(err);
    }
  });
}

// 从数据库获取记录的函数
async function getRecordsFromDatabase() {
  return new Promise((resolve, reject) => {
    try {
      const stmt = db.prepare('SELECT call_string, result FROM calls ORDER BY id DESC LIMIT 10');
      const rows = [];
      
      while (stmt.step()) {
        const row = stmt.getAsObject();
        rows.push(row);
      }
      
      stmt.free();
      resolve(rows);
    } catch (err) {
      console.error('从数据库获取记录失败:', err);
      reject(err);
    }
  });
}

// 动态加载并执行模块函数
async function executeModuleFunction(callString) {
  try {
    // 解析调用字符串，例如 cat.walk("tomy")
    const match = callString.match(/^(\w+)\.(\w+)\((.*)\)$/);
    if (!match) {
      return { error: '调用格式不正确，请使用 module.function(params) 格式' };
    }

    const [, moduleName, functionName, paramsString] = match;
    
    let modulePath;
    // 首先检查根目录
    if (moduleName === 'db' && fs.existsSync(path.join(__dirname, 'db.js'))) {
      modulePath = path.join(__dirname, 'db.js');
      console.log('使用根目录中的db.js模块');
    } else {
      // 否则查找scripts目录
      modulePath = path.join(__dirname, 'scripts', `${moduleName}.js`);
    }
    
    // 检查模块是否存在
    if (!fs.existsSync(modulePath)) {
      console.error(`模块 ${moduleName} 不存在, 路径: ${modulePath}`);
      return { error: `模块 ${moduleName} 不存在` };
    }
    
    console.log(`加载模块: ${modulePath}`);
    
    // 清除缓存并重新加载模块
    clearModuleCache(modulePath);
    const module = require(modulePath);
    
    // 检查函数是否存在
    if (typeof module[functionName] !== 'function') {
      console.error(`函数 ${functionName} 在模块 ${moduleName} 中不存在`);
      return { error: `函数 ${functionName} 在模块 ${moduleName} 中不存在` };
    }
    
    // 解析参数
    let params = [];
    if (paramsString.trim()) {
      // 这里使用更安全的方式解析参数，避免使用eval
      params = paramsString.split(',').map(param => {
        param = param.trim();
        if (param.startsWith('"') && param.endsWith('"')) {
          return param.slice(1, -1);
        } else if (param.startsWith("'") && param.endsWith("'")) {
          return param.slice(1, -1);
        } else if (param === 'true') {
          return true;
        } else if (param === 'false') {
          return false;
        } else if (param === 'null') {
          return null;
        } else if (param === 'undefined') {
          return undefined;
        } else if (!isNaN(param)) {
          return Number(param);
        }
        return param;
      });
    }
    
    console.log(`执行函数: ${moduleName}.${functionName}(${JSON.stringify(params)})`);
    
    // 执行函数
    let result;
    try {
      result = await Promise.resolve(module[functionName](...params));
      console.log(`函数执行成功，结果类型: ${typeof result}`);
    } catch (execError) {
      console.error(`执行函数出错: ${execError.message}`);
      return { error: `执行函数出错: ${execError.message}` };
    }
    
    // 存储到数据库
    try {
      console.log(`准备保存结果到数据库`);
      await saveToDatabase(callString, result);
      console.log(`结果已保存到数据库`);
    } catch (dbError) {
      console.error('保存到数据库失败，但函数执行成功', dbError);
    }
    
    return { success: result };
  } catch (error) {
    console.error(`执行模块函数时出错: ${error.message}`);
    return { error: error.message };
  }
}

// 获取可用模块列表
async function getAvailableModules() {
  try {
    const scriptsDir = path.join(__dirname, 'scripts');
    const files = fs.readdirSync(scriptsDir);
    
    const modules = [];
    
    for (const file of files) {
      if (file.endsWith('.js')) {
        const moduleName = file.replace('.js', '');
        const modulePath = path.join(scriptsDir, file);
        
        // 清除缓存并加载模块
        clearModuleCache(modulePath);
        const module = require(modulePath);
        
        // 获取模块中的所有函数
        const functions = [];
        for (const key in module) {
          if (typeof module[key] === 'function') {
            functions.push(key);
          }
        }
        
        modules.push({
          name: moduleName,
          functions: functions
        });
      }
    }
    
    return modules;
  } catch (error) {
    console.error('获取可用模块失败:', error);
    return [];
  }
}

// 创建前端页面HTML
function createHtml() {
  return `
  <!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>动态脚本执行器</title>
    <style>
      body {
        font-family: 'Arial', sans-serif;
        max-width: 800px;
        margin: 0 auto;
        padding: 20px;
        background-color: #f5f5f5;
      }
      h1 {
        color: #333;
        text-align: center;
      }
      .form-container {
        background-color: white;
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        margin-bottom: 20px;
      }
      input[type="text"] {
        width: 100%;
        padding: 10px;
        margin-bottom: 10px;
        border: 1px solid #ddd;
        border-radius: 4px;
        font-size: 16px;
      }
      button {
        background-color: #4CAF50;
        color: white;
        border: none;
        padding: 10px 15px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 16px;
      }
      button:hover {
        background-color: #45a049;
      }
      .modules-container {
        background-color: white;
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        min-height: 100px;
        margin-bottom: 20px;
      }
      .result-success {
        color: #4CAF50;
      }
      .result-error {
        color: #f44336;
      }
      .history-item {
        margin-bottom: 8px;
        padding: 8px;
        background-color: #f9f9f9;
        border-radius: 4px;
      }
      .module-item {
        margin-bottom: 5px;
      }
      .status-indicator {
        display: inline-block;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        margin-left: 10px;
      }
      .status-connected {
        background-color: #4CAF50;
      }
      .status-disconnected {
        background-color: #f44336;
      }
      .notification {
        position: fixed;
        bottom: 20px;
        right: 20px;
        background-color: #4CAF50;
        color: white;
        padding: 10px 20px;
        border-radius: 4px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        opacity: 0;
        transition: opacity 0.3s;
      }
      .notification.show {
        opacity: 1;
      }
    </style>
  </head>
  <body>
    <h1>动态脚本执行器</h1>
    <div class="form-container">
      <p>请输入要执行的模块函数，例如: cat.walk("tomy")</p>
      <input type="text" id="call-input" placeholder="module.function(params)">
      <button id="execute-btn">执行</button>
      <span id="ws-status" title="WebSocket连接状态"></span>
    </div>
    <div id="result-container" class="modules-container">
      <h3>执行结果:</h3>
      <div id="result"></div>
    </div>
    <div id="modules-container" class="modules-container" style="margin-top: 20px;">
      <h3>可用模块:</h3>
      <div id="modules-list"></div>
    </div>
    <div id="history-container" style="margin-top: 20px;">
      <h3>历史记录:</h3>
      <div id="history"></div>
    </div>
    <div id="notification" class="notification"></div>

    <script>
      document.addEventListener('DOMContentLoaded', () => {
        const callInput = document.getElementById('call-input');
        const executeBtn = document.getElementById('execute-btn');
        const resultDiv = document.getElementById('result');
        const historyDiv = document.getElementById('history');
        const modulesListDiv = document.getElementById('modules-list');
        const wsStatusIndicator = document.getElementById('ws-status');
        const notificationDiv = document.getElementById('notification');
        
        // WebSocket连接
        let socket;
        
        // 初始化WebSocket连接
        function initWebSocket() {
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          const wsUrl = \`\${protocol}//\${window.location.host}/ws\`;
          
          socket = new WebSocket(wsUrl);
          
          socket.onopen = function() {
            wsStatusIndicator.className = 'status-indicator status-connected';
            wsStatusIndicator.title = '已连接到服务器';
            console.log('WebSocket连接已建立');
          };
          
          socket.onclose = function() {
            wsStatusIndicator.className = 'status-indicator status-disconnected';
            wsStatusIndicator.title = '未连接到服务器';
            console.log('WebSocket连接已关闭，尝试重新连接...');
            
            // 5秒后尝试重新连接
            setTimeout(initWebSocket, 5000);
          };
          
          socket.onerror = function(error) {
            console.error('WebSocket错误:', error);
          };
          
          socket.onmessage = function(event) {
            try {
              const data = JSON.parse(event.data);
              
              if (data.type === 'modules_updated') {
                // 更新模块列表
                updateModulesList(data.modules);
                showNotification('脚本已更新，模块列表已刷新');
              }
            } catch (err) {
              console.error('处理WebSocket消息出错:', err);
            }
          };
        }
        
        // 显示通知
        function showNotification(message) {
          notificationDiv.textContent = message;
          notificationDiv.classList.add('show');
          
          setTimeout(() => {
            notificationDiv.classList.remove('show');
          }, 3000);
        }
        
        // 更新模块列表
        function updateModulesList(modules) {
          modulesListDiv.innerHTML = '';
          modules.forEach(module => {
            const moduleItem = document.createElement('div');
            moduleItem.className = 'module-item';
            
            const functions = module.functions.join(', ');
            moduleItem.innerHTML = \`<strong>\${module.name}</strong>: \${functions}\`;
            
            modulesListDiv.appendChild(moduleItem);
          });
        }
        
        // 加载历史记录和可用模块
        fetchHistory();
        fetchModules();
        
        // 初始化WebSocket
        initWebSocket();
        
        executeBtn.addEventListener('click', async () => {
          const callString = callInput.value.trim();
          if (!callString) {
            resultDiv.innerHTML = '<p class="result-error">请输入要执行的函数调用</p>';
            return;
          }
          
          try {
            resultDiv.innerHTML = '<p>正在执行...</p>';
            const response = await fetch('/execute', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ callString })
            });
            
            const data = await response.json();
            
            if (data.error) {
              resultDiv.innerHTML = \`<p class="result-error">错误: \${data.error}</p>\`;
            } else {
              resultDiv.innerHTML = \`<p class="result-success">结果: \${JSON.stringify(data.success)}</p>\`;
              // 刷新历史记录
              fetchHistory();
            }
          } catch (error) {
            resultDiv.innerHTML = \`<p class="result-error">请求错误: \${error.message}</p>\`;
          }
        });
        
        // 按Enter键执行
        callInput.addEventListener('keyup', (event) => {
          if (event.key === 'Enter') {
            executeBtn.click();
          }
        });
        
        async function fetchHistory() {
          try {
            const response = await fetch('/history');
            const data = await response.json();
            
            historyDiv.innerHTML = '';
            data.forEach(item => {
              const historyItem = document.createElement('div');
              historyItem.className = 'history-item';
              historyItem.innerHTML = \`
                <strong>调用:</strong> \${item.call_string}<br>
                <strong>结果:</strong> \${item.result}
              \`;
              historyDiv.appendChild(historyItem);
            });
          } catch (error) {
            historyDiv.innerHTML = \`<p class="result-error">获取历史记录失败: \${error.message}</p>\`;
          }
        }
        
        async function fetchModules() {
          try {
            const response = await fetch('/modules');
            const data = await response.json();
            
            updateModulesList(data.modules);
          } catch (error) {
            modulesListDiv.innerHTML = \`<p class="result-error">获取模块列表失败: \${error.message}</p>\`;
          }
        }
      });
    </script>
  </body>
  </html>
  `;
}

// 创建HTTP服务器
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  
  // 根据路径和请求方法处理不同的请求
  if (pathname === '/' && req.method === 'GET') {
    // 返回前端页面
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(createHtml());
  } 
  else if (pathname === '/execute' && req.method === 'POST') {
    // 处理执行请求
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', async () => {
      try {
        const { callString } = JSON.parse(body);
        const result = await executeModuleFunction(callString);
        
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(result));
      } catch (error) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: error.message }));
      }
    });
  }
  else if (pathname === '/history' && req.method === 'GET') {
    // 获取历史记录
    try {
      const records = await getRecordsFromDatabase();
      
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(records));
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: error.message }));
    }
  }
  else if (pathname === '/modules' && req.method === 'GET') {
    // 获取可用模块列表
    try {
      const modules = await getAvailableModules();
      
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ modules }));
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: error.message }));
    }
  }
  else {
    // 404 未找到
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('页面未找到');
  }
});

// 初始化数据库并启动服务器
(async () => {
  await initDatabase();
  
  // 创建HTTP服务器
  const PORT = 8080;
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`端口 ${PORT} 已被占用，请尝试使用其他端口`);
      process.exit(1);
    } else {
      console.error('服务器错误:', err);
    }
  });
  
  server.listen(PORT, () => {
    console.log(`服务器已启动，访问 http://localhost:${PORT}`);
    
    // 创建WebSocket服务器
    const wss = new WebSocket.Server({ server });
    
    wss.on('connection', (ws) => {
      console.log('新的WebSocket连接已建立');
      
      // 添加到客户端列表
      wsClients.push(ws);
      
      // 当连接关闭时从列表中移除
      ws.on('close', () => {
        console.log('WebSocket连接已关闭');
        wsClients = wsClients.filter(client => client !== ws);
      });
    });
    
    // 开始监控scripts目录
    watchScriptsDirectory();
  });
})();
