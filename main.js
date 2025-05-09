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
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
      :root {
        --primary-color: #3b82f6;
        --primary-hover: #2563eb;
        --secondary-color: #10b981;
        --light-bg: #f5f7fb;
        --light-panel: #ffffff;
        --light-header: #ffffff;
        --light-border: #e5e7eb;
        --text-dark: #1f2937;
        --text-gray: #6b7280;
        --danger-color: #ef4444;
        --success-color: #10b981;
        --warning-color: #f59e0b;
        --sidebar-width: 280px;
      }
      
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      
      body {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        background-color: var(--light-bg);
        color: var(--text-dark);
        line-height: 1.5;
        overflow-x: hidden;
      }
      
      .app-container {
        display: flex;
        min-height: 100vh;
      }
      
      /* 侧边栏样式 */
      .sidebar {
        width: var(--sidebar-width);
        background-color: var(--light-panel);
        border-right: 1px solid var(--light-border);
        position: fixed;
        height: 100vh;
        left: 0;
        top: 0;
        overflow-y: auto;
        transition: transform 0.3s ease;
        z-index: 100;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      }
      
      .sidebar-header {
        display: flex;
        align-items: center;
        padding: 20px;
        background-color: var(--light-header);
        height: 70px;
        border-bottom: 1px solid var(--light-border);
      }
      
      .logo {
        font-size: 24px;
        font-weight: 700;
        color: var(--text-dark);
        display: flex;
        align-items: center;
      }
      
      .logo i {
        color: var(--primary-color);
        margin-right: 10px;
      }
      
      .sidebar-content {
        padding: 20px 0;
      }
      
      .sidebar-nav {
        list-style: none;
      }
      
      .sidebar-nav-item {
        margin-bottom: 4px;
      }
      
      .sidebar-nav-link {
        display: flex;
        align-items: center;
        padding: 12px 20px;
        color: var(--text-gray);
        text-decoration: none;
        transition: all 0.2s ease;
        border-left: 3px solid transparent;
      }
      
      .sidebar-nav-link:hover {
        color: var(--text-dark);
        background-color: rgba(0, 0, 0, 0.03);
      }
      
      .sidebar-nav-link.active {
        color: var(--primary-color);
        background-color: rgba(59, 130, 246, 0.1);
        border-left: 3px solid var(--primary-color);
      }
      
      .sidebar-nav-link i {
        margin-right: 10px;
        width: 20px;
        text-align: center;
      }
      
      /* 主内容区域 */
      .main-content {
        flex: 1;
        margin-left: var(--sidebar-width);
        padding: 20px;
      }
      
      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        height: 70px;
        padding: 0 20px;
        background-color: var(--light-header);
        border-bottom: 1px solid var(--light-border);
        margin: -20px -20px 24px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
      }
      
      .header h1 {
        font-size: 20px;
        font-weight: 600;
        color: var(--text-dark);
      }
      
      .connection-status {
        display: flex;
        align-items: center;
      }
      
      .connection-status .status-indicator {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        margin-right: 6px;
      }
      
      .status-connected {
        background-color: var(--success-color);
      }
      
      .status-disconnected {
        background-color: var(--danger-color);
      }
      
      /* 卡片样式 */
      .card {
        background-color: var(--light-panel);
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
        margin-bottom: 24px;
        overflow: hidden;
        border: 1px solid var(--light-border);
      }
      
      .card-header {
        padding: 16px 24px;
        border-bottom: 1px solid var(--light-border);
        display: flex;
        justify-content: space-between;
        align-items: center;
        background-color: var(--light-header);
      }
      
      .card-title {
        font-size: 16px;
        font-weight: 600;
        margin: 0;
        color: var(--text-dark);
      }
      
      .card-body {
        padding: 24px;
      }
      
      /* 表单元素 */
      .form-group {
        margin-bottom: 20px;
      }
      
      .form-help {
        color: var(--text-gray);
        font-size: 13px;
        margin-bottom: 8px;
      }
      
      .input-group {
        display: flex;
      }
      
      .input-group input {
        flex: 1;
        margin-right: 10px;
      }
      
      input, select, textarea {
        width: 100%;
        padding: 12px 16px;
        border: 1px solid var(--light-border);
        border-radius: 4px;
        background-color: white;
        color: var(--text-dark);
        font-size: 14px;
        transition: all 0.2s ease;
      }
      
      input:focus, select:focus, textarea:focus {
        outline: none;
        border-color: var(--primary-color);
        box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
      }
      
      label {
        display: block;
        margin-bottom: 6px;
        font-weight: 500;
        color: var(--text-dark);
      }
      
      /* 按钮样式 */
      .btn {
        display: inline-block;
        padding: 12px 24px;
        border-radius: 4px;
        font-weight: 500;
        border: none;
        cursor: pointer;
        transition: all 0.2s ease;
        font-size: 14px;
      }
      
      .btn-primary {
        background-color: var(--primary-color);
        color: white;
      }
      
      .btn-primary:hover {
        background-color: var(--primary-hover);
      }
      
      .btn-sm {
        padding: 8px 16px;
        font-size: 12px;
      }
      
      /* 标签页 */
      .tabs {
        display: flex;
        list-style: none;
        border-bottom: 1px solid var(--light-border);
        margin-bottom: 20px;
      }
      
      .tab-item {
        margin-right: 4px;
        margin-bottom: -1px;
      }
      
      .tab-link {
        display: inline-block;
        padding: 12px 20px;
        color: var(--text-gray);
        text-decoration: none;
        border-bottom: 2px solid transparent;
        transition: all 0.2s ease;
      }
      
      .tab-link:hover {
        color: var(--text-dark);
      }
      
      .tab-link.active {
        color: var(--primary-color);
        border-bottom-color: var(--primary-color);
      }
      
      /* 表格样式 */
      .table-container {
        overflow-x: auto;
      }
      
      table {
        width: 100%;
        border-collapse: collapse;
      }
      
      th, td {
        padding: 12px 16px;
        text-align: left;
        border-bottom: 1px solid var(--light-border);
      }
      
      th {
        color: var(--text-gray);
        font-weight: 500;
        background-color: rgba(0, 0, 0, 0.02);
      }
      
      tr:hover {
        background-color: rgba(0, 0, 0, 0.02);
      }
      
      /* 模块列表 */
      .module-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
        gap: 16px;
        margin-top: 20px;
      }
      
      .module-item {
        background-color: var(--light-panel);
        border-radius: 4px;
        padding: 16px;
        border: 1px solid var(--light-border);
        cursor: pointer;
        transition: all 0.2s ease;
      }
      
      .module-item:hover {
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        transform: translateY(-2px);
      }
      
      .module-name {
        color: var(--text-dark);
        font-weight: 500;
        margin-bottom: 8px;
      }
      
      .module-functions {
        color: var(--text-gray);
        font-size: 13px;
      }
      
      /* 执行结果和历史记录 */
      .result-success {
        color: var(--text-dark);
        background-color: rgba(16, 185, 129, 0.1);
        padding: 16px;
        border-radius: 4px;
        border-left: 3px solid var(--success-color);
      }
      
      .result-error {
        color: var(--text-dark);
        background-color: rgba(239, 68, 68, 0.1);
        padding: 16px;
        border-radius: 4px;
        border-left: 3px solid var(--danger-color);
      }
      
      .history-item {
        padding: 16px;
        border-radius: 4px;
        background-color: var(--light-panel);
        margin-bottom: 12px;
        border: 1px solid var(--light-border);
      }
      
      .history-command {
        color: var(--primary-color);
        font-weight: 500;
        margin-bottom: 8px;
      }
      
      .history-result {
        color: var(--text-gray);
        font-size: 13px;
      }
      
      /* 数据库表格 */
      .db-results-container {
        max-height: 400px;
        overflow-y: auto;
        border-radius: 4px;
        border: 1px solid var(--light-border);
      }
      
      .db-results td pre {
        max-height: 100px;
        overflow-y: auto;
        white-space: pre-wrap;
        font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
        font-size: 12px;
      }
      
      /* 通知 */
      .notification {
        position: fixed;
        bottom: 20px;
        right: 20px;
        background-color: var(--light-panel);
        color: var(--text-dark);
        padding: 12px 20px;
        border-radius: 4px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        opacity: 0;
        transform: translateY(10px);
        transition: all 0.3s ease;
        border-left: 3px solid var(--primary-color);
        z-index: 1000;
      }
      
      .notification.show {
        opacity: 1;
        transform: translateY(0);
      }
      
      /* 移动端响应式 */
      @media screen and (max-width: 768px) {
        .sidebar {
          transform: translateX(-100%);
        }
        
        .sidebar.active {
          transform: translateX(0);
        }
        
        .main-content {
          margin-left: 0;
        }
        
        .mobile-menu-toggle {
          display: block;
        }
      }
      
      /* 移动菜单 */
      .mobile-menu-toggle {
        display: none;
        background: none;
        border: none;
        color: var(--text-dark);
        font-size: 24px;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <div class="app-container">
      <!-- 侧边栏 -->
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-header">
          <div class="logo">
            <i class="fas fa-code"></i>
            <span>脚本执行器</span>
          </div>
        </div>
        <div class="sidebar-content">
          <ul class="sidebar-nav">
            <li class="sidebar-nav-item">
              <a href="#executor" class="sidebar-nav-link active" data-target="executor-section">
                <i class="fas fa-play-circle"></i>
                <span>执行脚本</span>
              </a>
            </li>
            <li class="sidebar-nav-item">
              <a href="#history" class="sidebar-nav-link" data-target="history-section">
                <i class="fas fa-history"></i>
                <span>执行历史</span>
              </a>
            </li>
            <li class="sidebar-nav-item">
              <a href="#database" class="sidebar-nav-link" data-target="database-section">
                <i class="fas fa-database"></i>
                <span>数据库查询</span>
              </a>
            </li>
          </ul>
        </div>
      </aside>
      
      <!-- 主内容区域 -->
      <main class="main-content">
        <header class="header">
          <button class="mobile-menu-toggle" id="mobile-menu-toggle">
            <i class="fas fa-bars"></i>
          </button>
          <h1>动态脚本执行器</h1>
          <div class="connection-status">
            <span class="status-indicator" id="ws-status"></span>
            <span id="connection-text">WebSocket状态</span>
          </div>
        </header>
        
        <!-- 执行脚本部分 -->
        <section id="executor-section" class="content-section active">
          <div class="card">
            <div class="card-header">
              <h2 class="card-title">执行脚本</h2>
            </div>
            <div class="card-body">
              <div class="form-group">
                <label for="call-input">输入要执行的模块函数</label>
                <p class="form-help">例如: cat.walk("tomy") 或 db.getRecent(5)</p>
                <div class="input-group">
                  <input type="text" id="call-input" placeholder="module.function(params)">
                  <button id="execute-btn" class="btn btn-primary">执行</button>
                </div>
              </div>
              
              <div class="form-group">
                <label>执行结果</label>
                <div id="result"></div>
              </div>
            </div>
          </div>
          
          <!-- 可用模块部分（合并到执行脚本页面） -->
          <div class="card">
            <div class="card-header">
              <h2 class="card-title">可用模块</h2>
            </div>
            <div class="card-body">
              <div class="module-grid" id="modules-list">
                <!-- 模块列表将在这里动态加载 -->
              </div>
            </div>
          </div>
        </section>
        
        <!-- 执行历史部分 -->
        <section id="history-section" class="content-section" style="display:none;">
          <div class="card">
            <div class="card-header">
              <h2 class="card-title">执行历史</h2>
            </div>
            <div class="card-body">
              <div id="history">
                <!-- 历史记录将在这里动态加载 -->
              </div>
            </div>
          </div>
        </section>
        
        <!-- 数据库查询部分 -->
        <section id="database-section" class="content-section" style="display:none;">
          <div class="card">
            <div class="card-header">
              <h2 class="card-title">数据库查询</h2>
            </div>
            <div class="card-body">
              <ul class="tabs">
                <li class="tab-item">
                  <a href="#" class="tab-link active" id="tab-predefined">预定义查询</a>
                </li>
                <li class="tab-item">
                  <a href="#" class="tab-link" id="tab-custom">自定义SQL</a>
                </li>
              </ul>
              
              <div id="predefined-queries" class="tab-content">
                <div class="form-group">
                  <div class="query-buttons">
                    <button id="query-recent" class="btn btn-primary btn-sm">最近10条记录</button>
                    <button id="query-count" class="btn btn-primary btn-sm">记录总数</button>
                  </div>
                </div>
                
                <div class="form-group">
                  <label for="search-term">关键词搜索</label>
                  <div class="input-group">
                    <input type="text" id="search-term" placeholder="输入搜索关键词">
                    <button id="query-search" class="btn btn-primary">搜索</button>
                  </div>
                </div>
              </div>
              
              <div id="custom-query" class="tab-content" style="display:none;">
                <div class="form-group">
                  <label for="sql-input">SQL查询</label>
                  <div class="input-group">
                    <input type="text" id="sql-input" placeholder="输入SQL查询语句，例如: SELECT * FROM calls LIMIT 5">
                    <button id="run-sql-btn" class="btn btn-primary">执行查询</button>
                  </div>
                </div>
              </div>
              
              <div class="form-group">
                <label>查询结果</label>
                <div class="db-results-container">
                  <table class="db-results" id="db-results">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>调用字符串</th>
                        <th>结果</th>
                      </tr>
                    </thead>
                    <tbody id="db-results-body">
                      <!-- 查询结果将在这里显示 -->
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
    
    <div id="notification" class="notification"></div>

    <script>
      document.addEventListener('DOMContentLoaded', () => {
        // 获取DOM元素
        const sidebar = document.getElementById('sidebar');
        const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
        const navLinks = document.querySelectorAll('.sidebar-nav-link');
        const contentSections = document.querySelectorAll('.content-section');
        
        const callInput = document.getElementById('call-input');
        const executeBtn = document.getElementById('execute-btn');
        const resultDiv = document.getElementById('result');
        const historyDiv = document.getElementById('history');
        const modulesListDiv = document.getElementById('modules-list');
        const wsStatusIndicator = document.getElementById('ws-status');
        const connectionText = document.getElementById('connection-text');
        const notificationDiv = document.getElementById('notification');
        
        // 数据库查询相关元素
        const tabPredefined = document.getElementById('tab-predefined');
        const tabCustom = document.getElementById('tab-custom');
        const predefinedQueries = document.getElementById('predefined-queries');
        const customQuery = document.getElementById('custom-query');
        const sqlInput = document.getElementById('sql-input');
        const runSqlBtn = document.getElementById('run-sql-btn');
        const dbResultsBody = document.getElementById('db-results-body');
        const queryRecentBtn = document.getElementById('query-recent');
        const queryCountBtn = document.getElementById('query-count');
        const querySearchBtn = document.getElementById('query-search');
        const searchTermInput = document.getElementById('search-term');
        
        // 移动菜单切换
        mobileMenuToggle.addEventListener('click', () => {
          sidebar.classList.toggle('active');
        });
        
        // 导航菜单切换
        navLinks.forEach(link => {
          link.addEventListener('click', (e) => {
            e.preventDefault();
            
            // 更新激活的导航链接
            navLinks.forEach(item => item.classList.remove('active'));
            link.classList.add('active');
            
            // 显示对应的内容区域
            const targetId = link.getAttribute('data-target');
            contentSections.forEach(section => {
              section.style.display = section.id === targetId ? 'block' : 'none';
            });
            
            // 移动端关闭侧边栏
            if (window.innerWidth <= 768) {
              sidebar.classList.remove('active');
            }
          });
        });
        
        // 切换查询面板
        tabPredefined.addEventListener('click', (e) => {
          e.preventDefault();
          tabPredefined.classList.add('active');
          tabCustom.classList.remove('active');
          predefinedQueries.style.display = 'block';
          customQuery.style.display = 'none';
        });
        
        tabCustom.addEventListener('click', (e) => {
          e.preventDefault();
          tabPredefined.classList.remove('active');
          tabCustom.classList.add('active');
          predefinedQueries.style.display = 'none';
          customQuery.style.display = 'block';
        });
        
        // 预定义查询按钮
        queryRecentBtn.addEventListener('click', () => {
          fetchDbData('/api/db/recent');
        });
        
        queryCountBtn.addEventListener('click', () => {
          fetchDbData('/api/db/count');
        });
        
        querySearchBtn.addEventListener('click', () => {
          const term = searchTermInput.value.trim();
          if (term) {
            fetchDbData(\`/api/db/search?term=\${encodeURIComponent(term)}\`);
          } else {
            showNotification('请输入搜索关键词');
          }
        });
        
        // 执行自定义SQL查询
        runSqlBtn.addEventListener('click', async () => {
          const sql = sqlInput.value.trim();
          if (!sql) {
            showNotification('请输入SQL查询语句');
            return;
          }
          
          try {
            const response = await fetch('/api/db/query', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ sql })
            });
            
            const data = await response.json();
            
            if (data.error) {
              showNotification(\`查询错误: \${data.error}\`);
            } else {
              displayDbResults(data.results);
            }
          } catch (error) {
            showNotification(\`请求错误: \${error.message}\`);
          }
        });
        
        // 获取数据库数据
        async function fetchDbData(url) {
          try {
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.error) {
              showNotification(\`查询错误: \${data.error}\`);
            } else {
              displayDbResults(data.results);
            }
          } catch (error) {
            showNotification(\`请求错误: \${error.message}\`);
          }
        }
        
        // 显示数据库查询结果
        function displayDbResults(results) {
          dbResultsBody.innerHTML = '';
          
          if (!Array.isArray(results)) {
            // 处理非数组结果（如计数）
            const row = document.createElement('tr');
            row.innerHTML = \`
              <td colspan="3" style="text-align: center;">\${JSON.stringify(results)}</td>
            \`;
            dbResultsBody.appendChild(row);
            return;
          }
          
          if (results.length === 0) {
            const row = document.createElement('tr');
            row.innerHTML = \`<td colspan="3" style="text-align: center;">没有找到记录</td>\`;
            dbResultsBody.appendChild(row);
            return;
          }
          
          results.forEach(item => {
            const row = document.createElement('tr');
            
            // 处理不同的结果格式
            const id = item.id || '';
            const callString = item.call_string || '';
            let resultText = '';
            
            if (typeof item.result === 'string') {
              try {
                resultText = JSON.stringify(JSON.parse(item.result), null, 2);
              } catch (e) {
                resultText = item.result;
              }
            } else {
              resultText = JSON.stringify(item.result, null, 2);
            }
            
            row.innerHTML = \`
              <td>\${id}</td>
              <td>\${callString}</td>
              <td><pre>\${resultText}</pre></td>
            \`;
            dbResultsBody.appendChild(row);
          });
        }
        
        // 模块点击处理，自动填充到输入框
        function setupModuleItemListeners() {
          const moduleItems = document.querySelectorAll('.module-item');
          moduleItems.forEach(item => {
            item.addEventListener('click', () => {
              const moduleName = item.getAttribute('data-module');
              const functionName = item.getAttribute('data-function');
              
              if (moduleName && functionName) {
                callInput.value = \`\${moduleName}.\${functionName}()\`;
                callInput.focus();
                // 将光标放在括号内
                const cursorPos = callInput.value.length - 1;
                callInput.setSelectionRange(cursorPos, cursorPos);
              }
            });
          });
        }
        
        // WebSocket连接
        let socket;
        
        // 初始化WebSocket连接
        function initWebSocket() {
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          const wsUrl = \`\${protocol}//\${window.location.host}/ws\`;
          
          socket = new WebSocket(wsUrl);
          
          socket.onopen = function() {
            wsStatusIndicator.className = 'status-indicator status-connected';
            connectionText.textContent = 'WebSocket已连接';
            showNotification('WebSocket连接已建立');
          };
          
          socket.onclose = function() {
            wsStatusIndicator.className = 'status-indicator status-disconnected';
            connectionText.textContent = 'WebSocket已断开';
            showNotification('WebSocket连接已断开，尝试重新连接...');
            
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
          
          if (!modules.length) {
            modulesListDiv.innerHTML = '<p>没有可用的模块</p>';
            return;
          }
          
          modules.forEach(module => {
            const moduleName = module.name;
            
            // 为每个函数创建一个模块项
            module.functions.forEach(functionName => {
              const moduleItem = document.createElement('div');
              moduleItem.className = 'module-item';
              moduleItem.setAttribute('data-module', moduleName);
              moduleItem.setAttribute('data-function', functionName);
              
              moduleItem.innerHTML = \`
                <div class="module-name"><i class="fas fa-cube"></i> \${moduleName}.\${functionName}</div>
                <div class="module-functions">点击快速使用此函数</div>
              \`;
              
              modulesListDiv.appendChild(moduleItem);
            });
          });
          
          // 设置模块项点击事件
          setupModuleItemListeners();
        }
        
        // 加载历史记录
        async function fetchHistory() {
          try {
            const response = await fetch('/history');
            const data = await response.json();
            
            historyDiv.innerHTML = '';
            
            if (!data.length) {
              historyDiv.innerHTML = '<p>没有执行历史记录</p>';
              return;
            }
            
            data.forEach(item => {
              const historyItem = document.createElement('div');
              historyItem.className = 'history-item';
              historyItem.innerHTML = \`
                <div class="history-command"><i class="fas fa-terminal"></i> \${item.call_string}</div>
                <div class="history-result">\${item.result}</div>
              \`;
              historyDiv.appendChild(historyItem);
            });
          } catch (error) {
            historyDiv.innerHTML = \`<p class="result-error">获取历史记录失败: \${error.message}</p>\`;
          }
        }
        
        // 加载模块列表
        async function fetchModules() {
          try {
            const response = await fetch('/modules');
            const data = await response.json();
            
            updateModulesList(data.modules);
          } catch (error) {
            modulesListDiv.innerHTML = \`<p class="result-error">获取模块列表失败: \${error.message}</p>\`;
          }
        }
        
        // 执行脚本
        executeBtn.addEventListener('click', async () => {
          const callString = callInput.value.trim();
          if (!callString) {
            resultDiv.innerHTML = '<div class="result-error">请输入要执行的函数调用</div>';
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
              resultDiv.innerHTML = \`<div class="result-error">\${data.error}</div>\`;
            } else {
              resultDiv.innerHTML = \`<div class="result-success">\${JSON.stringify(data.success)}</div>\`;
              // 刷新历史记录
              fetchHistory();
              // 刷新数据库查询结果
              fetchDbData('/api/db/recent');
            }
          } catch (error) {
            resultDiv.innerHTML = \`<div class="result-error">请求错误: \${error.message}</div>\`;
          }
        });
        
        // 按Enter键执行
        callInput.addEventListener('keyup', (event) => {
          if (event.key === 'Enter') {
            executeBtn.click();
          }
        });
        
        // 按Enter键执行SQL查询
        sqlInput.addEventListener('keyup', (event) => {
          if (event.key === 'Enter') {
            runSqlBtn.click();
          }
        });
        
        // 加载历史记录和可用模块
        fetchHistory();
        fetchModules();
        
        // 加载初始数据库数据
        fetchDbData('/api/db/recent');
        
        // 初始化WebSocket
        initWebSocket();
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
  // 数据库API
  else if (pathname === '/api/db/recent' && req.method === 'GET') {
    try {
      // 获取最近的记录
      const stmt = db.prepare(`SELECT id, call_string, result FROM calls ORDER BY id DESC LIMIT 10`);
      const results = [];
      
      while (stmt.step()) {
        const row = stmt.getAsObject();
        results.push(row);
      }
      
      stmt.free();
      
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ results }));
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: error.message }));
    }
  }
  else if (pathname === '/api/db/count' && req.method === 'GET') {
    try {
      // 获取记录总数
      const stmt = db.prepare('SELECT COUNT(*) as count FROM calls');
      let count = 0;
      
      if (stmt.step()) {
        count = stmt.getAsObject().count;
      }
      
      stmt.free();
      
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ results: { 总记录数: count } }));
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: error.message }));
    }
  }
  else if (pathname === '/api/db/search' && req.method === 'GET') {
    try {
      const term = parsedUrl.query.term;
      
      if (!term) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: '缺少搜索关键词' }));
        return;
      }
      
      // 搜索记录
      const searchPattern = `%${term}%`;
      const stmt = db.prepare("SELECT id, call_string, result FROM calls WHERE call_string LIKE ? OR result LIKE ?");
      stmt.bind([searchPattern, searchPattern]);
      
      const results = [];
      while (stmt.step()) {
        const row = stmt.getAsObject();
        results.push(row);
      }
      
      stmt.free();
      
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ results }));
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: error.message }));
    }
  }
  else if (pathname === '/api/db/query' && req.method === 'POST') {
    // 处理自定义SQL查询
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', async () => {
      try {
        const { sql } = JSON.parse(body);
        
        if (!sql) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: '缺少SQL语句' }));
          return;
        }
        
        // 安全检查：只允许SELECT语句以防止修改数据库
        if (!sql.trim().toUpperCase().startsWith('SELECT')) {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: '仅允许SELECT查询' }));
          return;
        }
        
        // 执行SQL查询
        try {
          const stmt = db.prepare(sql);
          const results = [];
          
          while (stmt.step()) {
            const row = stmt.getAsObject();
            results.push(row);
          }
          
          stmt.free();
          
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ results }));
        } catch (sqlError) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: `SQL错误: ${sqlError.message}` }));
        }
      } catch (error) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: error.message }));
      }
    });
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
