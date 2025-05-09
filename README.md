# 动态脚本执行器

这是一个基于Node.js的动态脚本执行器，可以在不重启服务器的情况下，动态加载和执行scripts目录中的模块函数。

## 功能特点

- 在Web界面中执行scripts目录中的模块函数
- 动态加载模块，无需重启服务器即可加载新增或修改的模块和函数
- 显示可用模块和函数列表
- 记录执行历史，保存到SQLite数据库中
- 支持多种参数类型，如字符串、数字、布尔值等
- 适配多种数据库驱动(sqlite3/better-sqlite3)，提高兼容性

## 安装和运行

### 前提条件

- Node.js（建议使用v18或更高版本）
- 系统中已安装SQLite3（或使用better-sqlite3作为备选）

### 安装步骤

1. 克隆或下载项目代码
2. 安装依赖包：

```bash
npm install
```

3. 启动服务器：

```bash
npm start
```

4. 在浏览器中访问 http://localhost:8080

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
  return `Dog ${name} is barking: Woof! Woof!`;
};

exports.run = (name, speed) => {
  return `Dog ${name} is running at ${speed} km/h`;
};
```

完成后，刷新页面，您就可以调用`dog.bark("rex")`或`dog.run("rex", 20)`了。

## 故障排除

如果遇到sqlite3模块安装问题：

1. 确保系统中已安装SQLite3
2. 检查Node.js版本是否与sqlite3模块兼容
3. 如果仍有问题，程序会自动尝试使用better-sqlite3作为备选
4. 最后会自动降级为内存存储，但数据将不会持久化

## 安全注意事项

- 本程序避免了使用eval()，提高了安全性
- 在生产环境中使用时，应添加适当的授权和身份验证机制
- 建议不要在scripts目录中放置敏感操作代码