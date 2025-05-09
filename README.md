# 动态脚本执行器

这是一个基于Node.js的动态脚本执行器，可以在不重启服务器的情况下，动态加载和执行scripts目录中的模块函数。

## 功能特点

- 在Web界面中执行scripts目录中的模块函数
- 动态加载模块，无需重启服务器即可加载新增或修改的模块和函数
- 显示可用模块和函数列表
- 记录执行历史，保存到SQLite数据库中
- 支持多种参数类型，如字符串、数字、布尔值等

## 安装和运行

### 前提条件

- Node.js（建议使用v14至v20版本）
- 系统中已安装SQLite3（确保`sqlite3`命令可用）

### 安装步骤

1. 克隆或下载项目代码
2. 安装依赖包：

```bash
npm install
```

3. 初始化SQLite3数据库：

```bash
npm run init-db
```

4. 启动服务器：

```bash
npm start
```

5. 在浏览器中访问 http://localhost:8080

## 使用方法

1. 在输入框中输入要执行的函数调用，格式为：`模块名.函数名(参数1, 参数2, ...)`
   - 例如：`cat.walk("tomy")`
   - 例如：`cat.sayHi("hello", "tony")`

2. 点击"执行"按钮或按Enter键执行
3. 执行结果会显示在下方的结果区域
4. 历史记录会显示在页面底部

## 添加新模块或函数

您可以在不重启服务器的情况下：

1. 在`scripts`目录中添加新的`.js`文件（模块）
2. 在现有模块中添加或修改函数

所有新增的模块和函数都可以立即在前端页面中调用，无需重启服务器。

## 模块编写示例

在`scripts`目录中创建一个新文件，例如`dog.js`：

```javascript
exports.bark = (name) => {
  return `狗狗 ${name} 正在汪汪叫：汪! 汪!`;
};

exports.run = (name, speed) => {
  return `狗狗 ${name} 正以 ${speed} 公里/小时的速度奔跑`;
};
```

完成后，刷新页面，您就可以调用`dog.bark("rex")`或`dog.run("rex", 20)`了。

## SQLite3安装相关问题

如果在使用SQLite3模块时遇到问题：

1. 确保您使用的Node.js版本兼容sqlite3模块（建议Node.js v14-v20）
2. 对于Windows用户，请确保系统已安装Visual C++构建工具
3. 如果运行时出现sqlite3模块错误，可尝试重建模块：

```bash
npm rebuild sqlite3 --build-from-source
```

4. 如果仍然有问题，您可能需要全局安装node-gyp：

```bash
npm install -g node-gyp
```

## 安全注意事项

- 本程序避免了使用eval()，提高了安全性
- 在生产环境中使用时，应添加适当的授权和身份验证机制
- 建议不要在scripts目录中放置敏感操作代码