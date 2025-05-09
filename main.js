const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// 数据库实例
let db = null;
let isBetterSqlite = false;

// 尝试加载 sqlite3
try {
  const sqlite3 = require('sqlite3').verbose();
  console.log('使用 sqlite3 模块');
  
  // 创建数据库连接
  db = new sqlite3.Database('./calls.db');
  
  // 初始化数据库表
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_string TEXT,
      result TEXT
    )`);
  });
} catch (sqliteError) {
  console.error('sqlite3 加载失败，尝试使用 better-sqlite3');
  console.error(sqliteError);
  
  try {
    const betterSqlite3 = require('better-sqlite3');
    console.log('使用 better-sqlite3 模块');
    
    db = betterSqlite3('./calls.db');
    
    // 初始化数据库表
    db.exec(`CREATE TABLE IF NOT EXISTS calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_string TEXT,
      result TEXT
    )`);
    
    isBetterSqlite = true;
  } catch (betterSqliteError) {
    console.error('better-sqlite3 也加载失败，将使用内存存储');
    console.error(betterSqliteError);
    
    // 使用内存存储作为备用
    db = {
      inMemoryRecords: [],
      run: function(sql, params, callback) {
        if (sql.includes('INSERT INTO')) {
          this.inMemoryRecords.push({
            id: this.inMemoryRecords.length + 1,
            call_string: params[0],
            result: params[1]
          });
          if (callback) callback(null);
        }
      },
      all: function(sql, callback) {
        callback(null, this.inMemoryRecords.slice(-10).reverse());
      }
    };
  }
}

// 保存记录到数据库的函数
async function saveToDatabase(callString, result) {
  return new Promise((resolve, reject) => {
    const resultStr = JSON.stringify(result);
    
    if (isBetterSqlite) {
      try {
        const stmt = db.prepare('INSERT INTO calls (call_string, result) VALUES (?, ?)');
        stmt.run(callString, resultStr);
        resolve();
      } catch (err) {
        console.error('保存到数据库失败:', err);
        reject(err);
      }
    } else {
      db.run('INSERT INTO calls (call_string, result) VALUES (?, ?)', 
        [callString, resultStr], 
        function(err) {
          if (err) {
            console.error('保存到数据库失败:', err);
            reject(err);
          } else {
            resolve();
          }
        });
    }
  });
}

// 从数据库获取记录的函数
async function getRecordsFromDatabase() {
  return new Promise((resolve, reject) => {
    if (isBetterSqlite) {
      try {
        const stmt = db.prepare('SELECT call_string, result FROM calls ORDER BY id DESC LIMIT 10');
        const rows = stmt.all();
        resolve(rows);
      } catch (err) {
        console.error('从数据库获取记录失败:', err);
        reject(err);
      }
    } else {
      db.all('SELECT call_string, result FROM calls ORDER BY id DESC LIMIT 10', (err, rows) => {
        if (err) {
          console.error('从数据库获取记录失败:', err);
          reject(err);
        } else {
          resolve(rows);
        }
      });
    }
  });
}

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
    try {
      await saveToDatabase(callString, result);
    } catch (dbError) {
      console.error('保存到数据库失败，但函数执行成功', dbError);
    }
    
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
      .modules-container {
        background-color: white;
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        margin-bottom: 20px;
      }
      .module-item {
        margin-bottom: 5px;
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
    <div id="modules-container" class="modules-container">
      <h3>可用模块:</h3>
      <div id="modules-list"></div>
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
        const modulesListDiv = document.getElementById('modules-list');
        
        // 加载历史记录和可用模块
        fetchHistory();
        fetchModules();
        
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
            
            modulesListDiv.innerHTML = '';
            data.modules.forEach(module => {
              const moduleItem = document.createElement('div');
              moduleItem.className = 'module-item';
              
              const functions = module.functions.join(', ');
              moduleItem.innerHTML = \`<strong>\${module.name}</strong>: \${functions}\`;
              
              modulesListDiv.appendChild(moduleItem);
            });
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

// 启动服务器
const PORT = 8080;
server.listen(PORT, () => {
  console.log(`服务器已启动，访问 http://localhost:${PORT}`);
});
