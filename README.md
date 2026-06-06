# Light MD

<p align="center">
  <img src="src-tauri/icons/128x128.png" width="80" alt="Light MD Logo">
</p>

<p align="center">
  <b>极其轻量的 Markdown 编辑器</b><br>
  <sub>~5 MB 包体积 · 原生 macOS 集成 · 实时编辑预览 · 语义级滚动同步</sub>
</p>

<p align="center">
  <a href="#功能特性">功能特性</a> ·
  <a href="#安装">安装</a> ·
  <a href="#从源码构建">从源码构建</a> ·
  <a href="#技术栈">技术栈</a> ·
  <a href="#为什么做-light-md">为什么做 Light MD</a> ·
  <a href="#开源协议">开源协议</a>
</p>

---

## 功能特性

### 编辑体验
- **实时分屏预览** — 左侧编辑，右侧实时渲染，基于 [marked](https://marked.js.org/) + [highlight.js](https://highlightjs.org/)，支持 GitHub 风格换行
- **语义级滚动同步** — 不是简单的比例同步，而是基于源码块级结构的精确对齐。编辑器滚动到某个标题时，预览也会精准定位到同一个标题
- **CodeMirror 6 编辑器** — 语法高亮、行号、自动换行、深色/浅色主题
- **多标签页** — 同时编辑多个文档，标签页显示修改状态（蓝色圆点提示未保存）

### 文件管理
- **自动保存** — 编辑后 1.5 秒自动保存，新文档自动以首行内容作为文件名保存到 `~/Documents/LightMD/`
- **双击打开文件** — 注册为系统默认 `.md` 打开器，双击 Markdown 文件即可打开
- **拖拽打开** — 直接将 `.md` 文件拖入应用窗口即可打开
- **打开保存文件夹** — 一键在文件管理器中定位到保存目录

### 界面与交互
- **深色 / 浅色主题** — 支持一键切换，跟随系统偏好
- **可拖拽分栏** — 自由调整编辑器与预览区的宽度比例
- **关闭驻留后台** — 点击关闭按钮不会退出应用，而是隐藏到后台，下次从任务栏/Dock 点击瞬间唤醒
- **欢迎页** — 无文档时显示简洁的欢迎界面，快速新建或打开文件

## 安装

### 下载 Release（推荐）

前往 [Releases](../../releases) 页面下载对应平台的安装包：

| 平台 | 文件 | 说明 |
|------|------|------|
| macOS (Apple Silicon) | `Light MD_*_aarch64.dmg` | M1/M2/M3 Mac |
| macOS (Intel) | `Light MD_*_x86_64.dmg` | Intel Mac |
| Windows | `Light MD_*_x64-setup.exe` / `.msi` | Windows 10+ |
| Linux | `Light MD_*_amd64.deb` / `.AppImage` | Ubuntu/Debian 等 |

> ⚠️ **注意**：当前 Release 为**未签名版本**。macOS 用户首次打开需在右键菜单选择"打开"；Windows 用户如遇 Defender 拦截，请点击"更多信息" → "仍要运行"。

### macOS 设置为默认 Markdown 打开器

1. 在 Finder 中右键任意 `.md` 文件
2. 选择 **显示简介**
3. 在 **打开方式** 中选择 **Light MD**
4. 点击 **全部更改**

### 通过 GitHub Actions 自行构建

项目已配置 GitHub Actions，推送 `v*` 标签时自动为三个平台构建安装包：

```bash
# 给当前 commit 打 tag 并推送
git tag v0.1.0
git push origin v0.1.0
```

推送后，前往 [Actions](../../actions) 页面查看构建进度，构建完成后在 [Releases](../../releases) 页面下载。Fork 本仓库后，同样可以通过给自己的 tag 推送触发构建。

## 从源码构建

### 环境要求

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install)（用于 Tauri 后端）

### 构建步骤

```bash
# 克隆仓库
git clone https://github.com/noah-1106/light-md.git
cd light-md

# 安装前端依赖
npm install

# 开发模式启动
npm run tauri dev

# 构建 Release 版本
npm run tauri build
```

构建完成后，安装包位于各平台对应目录：
- **macOS**: `src-tauri/target/release/bundle/macos/Light MD.app`
- **Windows**: `src-tauri/target/release/bundle/msi/` 或 `bundle/nsis/`
- **Linux**: `src-tauri/target/release/bundle/deb/` 或 `bundle/appimage/`

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 桌面框架 | [Tauri 2.0](https://tauri.app/) | 基于系统 WebView，包体 ~5MB |
| 编辑器 | [CodeMirror 6](https://codemirror.net/) | Markdown 语法高亮、行号、主题 |
| 渲染引擎 | [marked](https://marked.js.org/) | Markdown → HTML，开启 GitHub 风格换行 |
| 代码高亮 | [highlight.js](https://highlightjs.org/) | 预览区代码块语法高亮 |
| 构建工具 | [Vite](https://vitejs.dev/) + TypeScript | 前端构建 |
| 后端 | Rust | 文件 I/O、跨平台原生集成 |
| CI/CD | GitHub Actions | 推送 Tag 自动构建 macOS / Windows / Linux 安装包 |

## 为什么做 Light MD

市面上主流的 Markdown 编辑器要么体积庞大（Electron 方案动辄 150MB+），要么功能过重。Light MD 的设计哲学是：

> **只做一件事，把它做到极致轻量。**

| 编辑器 | 包体积 | 启动速度 | 原生集成 |
|--------|--------|----------|----------|
| Typora | ~70 MB | 中等 | 一般 |
| VS Code | ~350 MB | 较慢 | 无（通用编辑器） |
| MarkText | ~180 MB | 中等 | 一般 |
| **Light MD** | **~5 MB** | **快** | **原生系统集成** |

Light MD 不追求 All-in-One，而是为"打开、编辑、保存 Markdown"这个核心场景提供极致流畅的体验。

## 项目结构

```
light-md/
├── src/                    # 前端源码（Vanilla TS + CSS）
│   ├── main.ts             # 编辑器、标签页、同步滚动、主题逻辑
│   ├── styles.css          # 全部 UI 样式
│   └── assets/             # 静态资源
├── src-tauri/              # Tauri / Rust 后端
│   ├── src/lib.rs          # 文件 I/O、macOS 集成命令
│   ├── icons/              # 应用图标（自动生成脚本）
│   └── tauri.conf.json     # Tauri 配置
├── scripts/
│   └── generate-icon.cjs   # 从 SVG 生成 macOS / Windows 图标
├── index.html              # 主页面结构
└── package.json
```

## 核心实现亮点

### 语义级滚动同步

区别于大多数编辑器的"比例同步"（滚动 50% 就同步到 50%），Light MD 实现了**结构锚点同步**：

1. 渲染预览时，扫描 Markdown 源码的每个块级元素（标题、段落、代码块、引用、列表等），记录其起始行号
2. 将行号注入到预览 HTML 对应元素的 `data-line` 属性中
3. 编辑器滚动时，通过 CodeMirror 的 `lineBlockAtHeight` 找到视口顶部的当前行号
4. 在预览中查找 `data-line` 最接近且不超过当前行号的元素，将其滚动到预览顶部

这样无论左右两侧内容高度如何差异，都能看到**语义一致**的内容。

### 自动文件名生成

新建文档时无需手动输入文件名，应用自动提取 Markdown 首行内容：
- 去除 `#` 标题标记和行内格式（加粗、斜体、代码、链接等）
- 清理非法文件名字符
- 截断至 40 个字符
- 保存为 `.md` 文件到 `~/Documents/LightMD/`

## 贡献

欢迎 Issue 和 PR！

如果你在使用中遇到任何问题，或有新功能建议，请直接提交 [Issue](../../issues)。

## 开源协议

[MIT](LICENSE) © Light MD Contributors
