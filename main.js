const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const sqlite3 = require('sqlite3').verbose();

// 创建数据库连接
const db = new sqlite3.Database('./calls.db');

// 初始化数据库表
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_string TEXT,
    result TEXT
  )`);
});

// 清除require缓存，确保每次都重新加载最新的模块
function clearModuleCache(modulePath) {
  const resolvedPath = require.resolve(modulePath);
  delete require.cache[resolvedPath];
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
    
    // 构建模块路径
    const modulePath = path.join(__dirname, 'scripts', `${moduleName}.js`);
    
    // 检查模块是否存在
    if (!fs.existsSync(modulePath)) {
      return { error: `模块 ${moduleName} 不存在` };
    }
    
    // 清除缓存并重新加载模块
    clearModuleCache(modulePath);
    const module = require(modulePath);
    
    // 检查函数是否存在
    if (typeof module[functionName] !== 'function') {
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
    
    // 执行函数
    const result = module[functionName](...params);
    
    // 存储到数据库
    await new Promise((resolve, reject) => {
      db.run('INSERT INTO calls (call_string, result) VALUES (?, ?)', 
        [callString, JSON.stringify(result)], 
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
    });
    
    return { success: result };
  } catch (error) {
    return { error: error.message };
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
      #result-container {
        background-color: white;
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        min-height: 100px;
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
    </style>
  </head>
  <body>
    <h1>动态脚本执行器</h1>
    <div class="form-container">
      <p>请输入要执行的模块函数，例如: cat.walk("tomy")</p>
      <input type="text" id="call-input" placeholder="module.function(params)">
      <button id="execute-btn">执行</button>
    </div>
    <div id="result-container">
      <h3>执行结果:</h3>
      <div id="result"></div>
    </div>
    <div id="history-container" style="margin-top: 20px;">
      <h3>历史记录:</h3>
      <div id="history"></div>
    </div>

    <script>
      document.addEventListener('DOMContentLoaded', () => {
        const callInput = document.getElementById('call-input');
        const executeBtn = document.getElementById('execute-btn');
        const resultDiv = document.getElementById('result');
        const historyDiv = document.getElementById('history');
        
        // 加载历史记录
        fetchHistory();
        
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
    db.all('SELECT call_string, result FROM calls ORDER BY id DESC LIMIT 10', (err, rows) => {
      if (err) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
      
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(rows));
    });
  }
  else {
    // 404 未找到
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('页面未找到');
  }
});

// 启动服务器
const PORT = 8080;
server.listen(PORT, () => {
  console.log(`服务器已启动，访问 http://localhost:${PORT}`);
});
