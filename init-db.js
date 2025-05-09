const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

console.log('正在创建 SQLite3 数据库...');

// 数据库文件路径
const dbPath = path.join(__dirname, 'calls.db');

// 检查数据库是否已存在
if (fs.existsSync(dbPath)) {
  console.log(`数据库文件已存在: ${dbPath}`);
  console.log('如需重新创建，请先删除现有数据库文件');
  process.exit(0);
}

// 创建数据库连接
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('创建数据库失败:', err.message);
    process.exit(1);
  }
  console.log(`成功创建数据库文件: ${dbPath}`);
});

// 创建表
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_string TEXT,
    result TEXT
  )`, (err) => {
    if (err) {
      console.error('创建表失败:', err.message);
    } else {
      console.log('成功创建表: calls');
    }
  });
});

// 关闭数据库连接
db.close((err) => {
  if (err) {
    console.error('关闭数据库连接失败:', err.message);
    process.exit(1);
  }
  console.log('数据库初始化完成！');
}); 