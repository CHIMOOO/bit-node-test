const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

console.log('正在创建 SQL.js 数据库...');

// 数据库文件路径
const dbPath = path.join(__dirname, 'calls.db');

// 检查数据库是否已存在
if (fs.existsSync(dbPath)) {
  console.log(`数据库文件已存在: ${dbPath}`);
  console.log('如需重新创建，请先删除现有数据库文件');
  process.exit(0);
}

// 异步初始化数据库
async function initDatabase() {
  try {
    // 初始化 SQL.js
    const SQL = await initSqlJs();
    
    // 创建新数据库
    const db = new SQL.Database();
    console.log(`成功创建数据库`);
    
    // 创建表
    db.run(`CREATE TABLE IF NOT EXISTS calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_string TEXT,
      result TEXT
    )`);
    console.log('成功创建表: calls');
    
    // 导出数据库为二进制数据并保存到文件
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
    console.log(`数据库文件已保存到: ${dbPath}`);
    
    console.log('数据库初始化完成！');
  } catch (err) {
    console.error('创建数据库失败:', err.message);
    process.exit(1);
  }
}

// 执行初始化
initDatabase(); 