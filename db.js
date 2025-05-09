const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

// 数据库文件路径
const dbPath = path.join(__dirname, 'calls.db');

// 读取数据库函数
async function readDatabase() {
  try {
    // 初始化 SQL.js
    const SQL = await initSqlJs();
    
    // 检查数据库文件是否存在
    if (!fs.existsSync(dbPath)) {
      return { error: '数据库文件不存在' };
    }
    
    // 读取数据库文件
    const filebuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(filebuffer);
    
    return { db, SQL };
  } catch (err) {
    return { error: err.message };
  }
}

// 获取最近的记录
exports.getRecent = async function(limit = 10) {
  const result = await readDatabase();
  
  if (result.error) {
    return `查询错误: ${result.error}`;
  }
  
  try {
    const db = result.db;
    const stmt = db.prepare(`SELECT id, call_string, result FROM calls ORDER BY id DESC LIMIT ?`);
    stmt.bind([limit]);
    
    const results = [];
    while(stmt.step()) {
      const row = stmt.getAsObject();
      // 尝试解析result字段中的JSON
      try {
        row.result = JSON.parse(row.result);
      } catch (e) {
        // 如果无法解析，保持原样
      }
      results.push(row);
    }
    
    stmt.free();
    return results;
  } catch (err) {
    return `查询错误: ${err.message}`;
  }
};

// 根据ID查询记录
exports.getById = async function(id) {
  const result = await readDatabase();
  
  if (result.error) {
    return `查询错误: ${result.error}`;
  }
  
  try {
    const db = result.db;
    const stmt = db.prepare('SELECT id, call_string, result FROM calls WHERE id = ?');
    stmt.bind([id]);
    
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      
      // 尝试解析result字段中的JSON
      try {
        row.result = JSON.parse(row.result);
      } catch (e) {
        // 如果无法解析，保持原样
      }
      
      return row;
    } else {
      stmt.free();
      return `未找到ID为${id}的记录`;
    }
  } catch (err) {
    return `查询错误: ${err.message}`;
  }
};

// 查询包含特定字符串的记录
exports.search = async function(keyword) {
  const result = await readDatabase();
  
  if (result.error) {
    return `查询错误: ${result.error}`;
  }
  
  try {
    const db = result.db;
    const stmt = db.prepare("SELECT id, call_string, result FROM calls WHERE call_string LIKE ? OR result LIKE ?");
    const searchPattern = `%${keyword}%`;
    stmt.bind([searchPattern, searchPattern]);
    
    const results = [];
    while(stmt.step()) {
      const row = stmt.getAsObject();
      // 尝试解析result字段中的JSON
      try {
        row.result = JSON.parse(row.result);
      } catch (e) {
        // 如果无法解析，保持原样
      }
      results.push(row);
    }
    
    stmt.free();
    return results;
  } catch (err) {
    return `查询错误: ${err.message}`;
  }
};

// 获取总记录数
exports.count = async function() {
  const { db, error } = await readDatabase();
  
  if (error) {
    return `查询错误: ${error}`;
  }
  
  try {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM calls');
    
    if (stmt.step()) {
      const result = stmt.getAsObject();
      stmt.free();
      return result.count;
    } else {
      stmt.free();
      return 0;
    }
  } catch (err) {
    return `查询错误: ${err.message}`;
  }
}; 