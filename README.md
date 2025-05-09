# 动态脚本执行器

这是一个基于Node.js的动态脚本执行器，允许用户通过Web界面调用预定义的脚本函数。本项目使用SQL.js作为数据库，可以记录函数调用历史和结果。

## 功能特点

- 🌐 Web界面调用脚本函数
- 📝 记录函数调用历史
- 🔄 动态加载脚本模块
- 📊 显示可用模块和函数
- 💾 使用SQL.js进行数据存储（基于SQLite但无需原生绑定）

## 安装

```bash
# 克隆项目
git clone <项目地址>
cd <项目目录>

# 安装依赖
npm install
```

## 初始化数据库

```bash
npm run init-db
```

## 启动服务器

```bash
npm start
```

启动后，访问 http://localhost:8080 即可使用Web界面。

## 添加自定义脚本

1. 在`scripts`目录下创建JavaScript文件
2. 导出函数，例如：

```javascript
// scripts/myModule.js
exports.myFunction = function(param1, param2) {
  return `执行结果: ${param1}, ${param2}`;
};
```

3. 在Web界面中，以`myModule.myFunction("value1", "value2")`的形式调用

## 技术实现

- 前端：纯JavaScript + HTML
- 后端：Node.js
- 数据库：SQL.js (SQLite的WebAssembly实现)
- HTTP服务器：Node.js内置http模块

## 文件结构

```
├── main.js           # 主服务器文件
├── init-db.js        # 数据库初始化脚本
├── scripts/          # 脚本目录
│   ├── cat.js        # 示例脚本
│   └── dog.js        # 示例脚本
├── calls.db          # SQLite数据库文件
└── package.json      # 项目配置文件
```

## 注意事项

- 本项目使用SQL.js替代sqlite3，无需编译原生模块
- 为了安全起见，此服务器应仅在受信任的环境中使用