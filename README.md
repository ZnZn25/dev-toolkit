# Local Format Studio

Windows 桌面端 JSON / SQL 格式化工具。格式化在 Web Worker 中运行；SQL 不会执行，也不会连接数据库。

## 功能

- JSON 美化、压缩、校验、字符串转义/反转义；缩进支持 2 空格、4 空格和 Tab。
- JSON 使用严格解析，错误状态显示行号和列号。格式器保留数字、字符串和键的原始词元，所以不会把大整数舍入，也不会合并重复键。
- SQL 使用 PostgreSQL 方言，另可选 MySQL 和 SQL Server；支持关键字大小写、常见 DML / DDL、多语句、注释、引号标识符、参数和 PostgreSQL 运算符。
- SQL 格式化后会比对原文与结果的词元顺序。字符串、注释、数字、操作符、标点或引号标识符被改写时，会拒绝结果并保留原始输入。格式器不解析或执行 SQL。
- Monaco 双编辑器支持语法着色、行号、折叠、自动换行、撤销/重做、拖入文件、单侧编辑区最大化、深浅主题和缩放字号。
- 可打开 JSON / SQL / 文本文件；只在用户显式保存时写入结果。
- 编辑器内容不自动保存、不写入设置存储、不发送网络请求。设置只保存在本机 `localStorage`。

## 技术选择

- Tauri 2 + Vue 3 + TypeScript + Vite + Monaco Editor。
- `jsonc-parser` 仅用作严格 JSON 语法树解析和错误定位；输出器从原文切片读取值词元，以免原生 `JSON.stringify` 改写大整数的精度或字符串转义形式。
- `sql-formatter` 在本机 PostgreSQL 方言下格式化；它覆盖多种方言且无需服务端。词元检查是保守的安全护栏，不是 PostgreSQL 语法分析器；存储过程、扩展语法和新方言功能仍需按实际 SQL 样例核对，遇到词元变化会报错，不会把结果覆盖到输入。
- 未加 Element Plus：界面只需要少量工具栏和设置控件，自定义 CSS 减少运行时和安装包依赖。Monaco 是体积最大的依赖。

## 开发环境

- Windows 10 / 11；Windows 构建需要 Rust stable MSVC、Microsoft C++ Build Tools（“Desktop development with C++”）和 WebView2。
- Node.js 22.16 或更新版本，以及 npm。

安装 Rust 和 C++ 工具链后，在项目根目录执行：

```powershell
npm ci
npm run dev
```

`npm run dev` 在 `http://127.0.0.1:1420` 启动本地预览。该浏览器预览可检查前端交互；原生文件对话框、拖放路径和安装程序必须在 Tauri 桌面构建中验证。

运行逻辑检查和生产前端构建：

```powershell
npm run check
npm run build
```

构建 Windows NSIS 安装包：

```powershell
npm run tauri:build
```

安装包会生成在 `src-tauri/target/release/bundle/nsis/`；独立程序在 `src-tauri/target/release/`。WebView2 使用系统运行时，安装包默认在目标系统缺少运行时时静默下载官方引导程序；应用安装后，格式化本身可离线运行。若必须保证全离线安装，可改用 Tauri 的 `offlineInstaller` 模式，代价是安装包额外增加约 127 MB。

## 快捷键

| 快捷键 | 操作 |
| --- | --- |
| `Ctrl+Alt+L` | 格式化当前模式 |
| `Ctrl+C` | 焦点在 Monaco 编辑器时沿用编辑器复制；焦点在编辑器外时复制结果 |
| `Ctrl+O` | 打开文件 |
| `Ctrl+S` | 保存格式化结果 |
| `Ctrl+L` | 编辑器外清空输入和结果（确认后执行） |
| `Ctrl+1` / `Ctrl+2` | 编辑器外切换 JSON / SQL 模式 |

编辑器聚焦时，Monaco 保留自己的 `Ctrl+C`、`Ctrl+L`、`Ctrl+1/2` 等按键行为；也可直接使用工具栏。

## 验证范围

`npm run check` 覆盖大整数与重复键、Unicode/转义、JSON 错误位置、压缩、PostgreSQL `DISTINCT ON` / `::` / JSON 运算符 / `$n` 参数 / `RETURNING` / `ON CONFLICT`、CREATE/ALTER TABLE、注释、多语句以及 MySQL / SQL Server 样例。

## Git 分支流程

- `main` 仅保存已验证、可发布的稳定版本。
- `develop` 是日常开发集成分支。
- 新功能从 `develop` 创建 `feature/<名称>`；普通问题修复从 `develop` 创建 `fix/<名称>`。完成代码审查和测试后合并回 `develop`。
- 紧急生产修复从 `main` 创建 `hotfix/<名称>`；修复验证后分别合并回 `main` 和 `develop`。
- 只有在确认版本稳定并准备发布时，才将 `develop` 合并到 `main`。未经明确确认，不自动合并到 `main` 或删除远程分支。
