# 实用工具箱

Windows 桌面端开发实用工具箱，基于 Tauri + Vue 3 + TypeScript。除用户主动执行的 HTTP 请求和 Ping 外，数据处理均在本机完成；SQL 不会执行，也不会连接数据库。

## 功能

- JSON 美化、压缩、校验、字符串转义/反转义；缩进支持 2 空格、4 空格和 Tab。
- JSON 使用严格解析，错误状态显示行号和列号。格式器保留数字、字符串和键的原始词元，所以不会把大整数舍入，也不会合并重复键。
- SQL 使用 PostgreSQL 方言，另可选 MySQL 和 SQL Server；支持关键字大小写、常见 DML / DDL、多语句、注释、引号标识符、参数和 PostgreSQL 运算符。
- UUID v4 批量生成，支持标准小写、大写、无连字符、URN 和花括号格式；数量可自定义，提供 10、30、50 个快捷选项，最多 10,000 个。
- 条形码 / 二维码生成器支持 QR、Code 128、Code 39、EAN-13、EAN-8、UPC-A 和 ITF-14；二维码可选纠错等级，结果在本地生成 SVG，可预览、复制源码和保存。
- 时间戳支持秒 / 毫秒与 ISO 日期互转；Base64 按 UTF-8 文本编解码；URL 使用百分号编码解码；Ping 支持指定次数或持续发送并随时停止。
- 文本 Diff 并列接收原文和新文，按行输出新增、删除和未变更内容；正则测试显示匹配位置与捕获组，并在独立 Worker 内一秒超时。
- Hash 支持 SHA-1、SHA-256、SHA-384、SHA-512；JWT 只解码 Header / Payload，不验证签名或声明。
- 文本行去重并按自然顺序排序，可选择是否区分大小写；另有全局文本替换和文本 Diff。进制转换支持 2 / 8 / 10 / 16 进制和任意精度整数。
- JSON ↔ YAML 转换只接受 JSON 兼容类型；重复 JSON 键和不安全整数会明确报错，避免悄悄丢失数据精度。
- XML 使用浏览器内置解析器校验和缩进，YAML 使用随应用打包的解析器校验和格式化。
- Cron 检查标准五段数字表达式并显示本地时区的下五个运行时间；HTTP 请求支持常用方法、请求头、Body、超时和响应信息。
- HTTP 响应解析器可整理状态行、响应头及 JSON / XML / YAML 正文，不发送网络请求。
- 实时日志查看器可跟踪本地 Spring Boot `.log` / `.txt` 文件，增量读取并高亮日志级别，支持时间、关键字和线程筛选；端口占用检测器可查看 Windows 本机 TCP / UDP 端点、PID 和进程路径，结束进程前显示二次确认并复核进程身份。
- HTTP 调试仅在点击“执行”后发送。Tauri 桌面端使用本机 HTTP 插件直连目标站点；浏览器预览仍受浏览器 CORS 规则限制。Ping 只在用户开始时使用本机系统命令向所填主机发送 ICMP 请求，输入不会经过 shell。
- SQL 格式化后会比对原文与结果的词元顺序。字符串、注释、数字、操作符、标点或引号标识符被改写时，会拒绝结果并保留原始输入。格式器不解析或执行 SQL。
- Monaco 编辑器支持语法着色、行号、折叠、自动换行、撤销/重做、拖入文件、单侧编辑区最大化、深浅主题和缩放字号；格式化结果支持搜索、高亮和命中统计。
- 每个工具页面都可从工具栏的历史下拉菜单查看本工具记录，按日期分组并可展开查看输入和结果；可清空全部历史。JWT、HTTP、Ping 和响应解析历史会保留输入、请求头、正文及结果；全部历史仅保存在本次会话内存（最近 50 条 / 约 100 万字符），不会写入磁盘，可用“清空全部”移除。
- 侧栏支持按名称或分类搜索，Ctrl+K 聚焦搜索框；最近使用工具可折叠显示，并在本机记住最近 4 项工具名称（不保存编辑内容）。
- 可打开 JSON / SQL / XML / YAML / 文本文件；只在用户显式保存时写入结果。
- 编辑器内容不自动保存，也不写入设置存储。除用户主动发送的 HTTP 请求或 Ping 外，应用不发送网络请求；设置只保存在本机 `localStorage`。

## 技术选择

- Tauri 2 + Vue 3 + TypeScript + Vite + Monaco Editor。
- `jsonc-parser` 仅用作严格 JSON 语法树解析和错误定位；输出器从原文切片读取值词元，以免原生 `JSON.stringify` 改写大整数的精度或字符串转义形式。
- `sql-formatter` 在本机 PostgreSQL 方言下格式化；它覆盖多种方言且无需服务端。词元检查是保守的安全护栏，不是 PostgreSQL 语法分析器；存储过程、扩展语法和新方言功能仍需按实际 SQL 样例核对，遇到词元变化会报错，不会把结果覆盖到输入。
- `yaml` 在本机解析并输出 YAML；XML 使用 WebView 的 `DOMParser` / `XMLSerializer`。Hash 使用 Web Crypto；JWT 解析不会校验签名。
- `tauri-plugin-http` 在桌面端通过 Rust 客户端发请求，避免浏览器 CORS 限制。能力范围只允许 HTTP / HTTPS，目标 URL 由用户输入；该工具只在显式执行时联网。Ping 桌面端由 Rust 调用系统 `ping.exe`；本地 Web 开发、预览和服务通过仅接受回环来源的本地接口调用系统 Ping，不提供任意命令执行入口。
- 未加 Element Plus：界面只需要少量工具栏和设置控件，自定义 CSS 减少运行时和安装包依赖。Monaco 是体积最大的依赖。

## 开发环境

- Windows 10 / 11；Web 运行需要 Node.js 22.16 或更新版本和 npm。
- 桌面版开发/打包另外需要 Rust stable MSVC、Microsoft C++ Build Tools（“Desktop development with C++”）和 WebView2。

在项目根目录执行：

```powershell
npm ci
npm run dev
```

`npm run dev` 启动 Web 开发模式，按 `8299`、`8399`、`8499` 的顺序选择首个空闲端口（优先地址为 `http://localhost:8299`），并且仅监听本机。JSON、SQL、UUID 等功能由同一套 Vue 组件和本地逻辑提供；浏览器模式使用文件选择器、下载和系统剪贴板 Web API 替代 Tauri 文件对话框。HTTP 请求工具仅在用户主动发送时联网。

检查 Web 生产构建并预览：

```powershell
npm run check
npm run build
npm run preview
```

`npm run build` 将静态 Web 文件输出到 `dist/`；`npm run preview` 在 `http://localhost:8080` 预览构建结果。需长期本机使用时，运行 `npm run serve:web` 启动项目自带的 Node 静态服务。服务只绑定 `127.0.0.1:8080`，不会开放给局域网。

Windows 可双击项目根目录的 `start-web.cmd`：依赖已安装时会先构建，再启动本机服务并打开默认浏览器。保持命令窗口开启即可使用；按 `Ctrl+C` 停止。首次从源码启动前运行一次 `npm ci`。`npm run preview` 与 `npm run serve:web` 使用相同的 8080 端口，不要同时运行。

Tauri 桌面开发仍使用独立的 `1420` 端口和同一套生产构建配置：

```powershell
npm run tauri:dev
```

构建 Windows NSIS 安装包：

```powershell
npm run tauri:build
```

安装包会生成在 `src-tauri/target/release/bundle/nsis/`；独立程序在 `src-tauri/target/release/`。WebView2 使用系统运行时，安装包默认在目标系统缺少运行时时静默下载官方引导程序；应用安装后，格式化本身可离线运行。若必须保证全离线安装，可改用 Tauri 的 `offlineInstaller` 模式，代价是安装包额外增加约 127 MB。

### 自动发布 Windows 安装包

准备发布时，将 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json` 的版本号统一升级，并推送到 `main`。GitHub Actions 会先检查版本，再运行 `npm run check` 和 Windows NSIS 打包，并自动创建或补齐对应的 `v<版本号>` Release 与安装包附件。版本号没有变化时不会重复发布。

## 快捷键

| 快捷键 | 操作 |
| --- | --- |
| `Ctrl+Alt+L` | 执行当前工具；UUID 模式下生成 UUID |
| `Ctrl+C` | 焦点在 Monaco 编辑器时沿用编辑器复制；焦点在编辑器外时复制结果 |
| `Ctrl+X` | 输入区剪切所选文本；结果区剪切整份结果到剪贴板并清空结果 |
| `Ctrl+O` | 打开文件 |
| `Ctrl+S` | 保存格式化结果 |
| `Ctrl+L` | 编辑器外清空输入和结果（确认后执行） |
| `Ctrl+1` / `Ctrl+2` | 编辑器外切换 JSON / SQL 模式 |
| `Ctrl+K` | 编辑器外聚焦工具搜索 |

编辑器聚焦时，Monaco 保留自己的 `Ctrl+C`、`Ctrl+L`、`Ctrl+1/2` 等按键行为；结果区的 `Ctrl+X` 会先复制整份结果，剪贴板写入成功后再清空结果。也可直接使用工具栏。

## 验证范围

`npm run check` 覆盖 JSON / SQL 边界、条码 / 二维码、JSON ↔ YAML、文本替换、HTTP 响应解析、UUID、时间戳、Base64 / URL、Diff、正则、Hash、JWT、YAML、Cron、进制、模拟 HTTP 响应、日志解析 / 筛选和端口输入校验。`npm run build` 运行 `vue-tsc` 和 Vite 生产构建；`cargo check --manifest-path src-tauri/Cargo.toml` 检查 Tauri 插件与原生端。

## Git 分支流程

- `main` 仅保存已验证、可发布的稳定版本。
- `develop` 是日常开发集成分支。
- 新功能从 `develop` 创建 `feature/<名称>`；普通问题修复从 `develop` 创建 `fix/<名称>`。完成代码审查和测试后合并回 `develop`。
- 紧急生产修复从 `main` 创建 `hotfix/<名称>`；修复验证后分别合并回 `main` 和 `develop`。
- 只有在确认版本稳定并准备发布时，才将 `develop` 合并到 `main`。未经明确确认，不自动合并到 `main` 或删除远程分支。
