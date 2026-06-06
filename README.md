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
- **从 Finder 打开** — 注册为 macOS 默认 `.md` 打开器，双击 Markdown 文件即用 Light MD 打开
- **拖拽打开** — 直接将 `.md` 文件拖入应用窗口即可打开
- **打开默认文件夹** — 一键在 Finder 中定位到保存目录

### 界面与交互
- **深色 / 浅色主题** — 支持一键切换，跟随系统偏好
- **可拖拽分栏** — 自由调整编辑器与预览区的宽度比例
- **窗口关闭即驻留 Dock** — 点击关闭按钮不会退出应用，而是隐藏到后台，下次从 Dock 点击瞬间唤醒
- **欢迎页** — 无文档时显示简洁的欢迎界面，快速新建或打开文件

## 安装

### 下载 Release（推荐）

前往 [Releases](../../releases) 页面下载最新的 `Light MD_*.dmg`，双击安装后将应用拖入 **应用程序** 文件夹。

### 设置为默认 Markdown 打开器

1. 在 Finder 中右键任意 `.md` 文件
2. 选择 **显示简介**
3. 在 **打开方式** 中选择 **Light MD**
4. 点击 **全部更改**

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

构建完成后，应用位于 `src-tauri/target/release/bundle/macos/Light MD.app`，DMG 安装包位于 `src-tauri/target/release/bundle/dmg/`。

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 桌面框架 | [Tauri 2.0](https://tauri.app/) | 基于系统 WebView，包体 ~5MB |
| 编辑器 | [CodeMirror 6](https://codemirror.net/) | Markdown 语法高亮、行号、主题 |
| 渲染引擎 | [marked](https://marked.js.org/) | Markdown → HTML，开启 GitHub 风格换行 |
| 代码高亮 | [highlight.js](https://highlightjs.org/) | 预览区代码块语法高亮 |
| 构建工具 | [Vite](https://vitejs.dev/) + TypeScript | 前端构建 |
| 后端 | Rust | 文件 I/O、macOS 原生集成 |

## 为什么做 Light MD

市面上主流的 Markdown 编辑器要么体积庞大（Electron 方案动辄 150MB+），要么功能过重。Light MD 的设计哲学是：

> **只做一件事，把它做到极致轻量。**

| 编辑器 | 包体积 | 启动速度 | 原生集成 |
|--------|--------|----------|----------|
| Typora | ~70 MB | 中等 | 一般 |
| VS Code | ~350 MB | 较慢 | 无（通用编辑器） |
| MarkText | ~180 MB | 中等 | 一般 |
| **Light MD** | **~5 MB** | **快** | **深度 macOS 集成** |

Light MD 不追求 All-in-One，而是为"打开、编辑、保存 Markdown"这个核心场景提供极致流畅的体验。

## 项目结构

```
light-md/
├── src/                    # 前端源码（Vanilla TS + CSS）
│   ├── main.ts             # 编辑器、标签页、同步滚动、主题逻辑
│   ├── styles.css          # 全部 UI 样式
│   └── main.ts             # Vite 入口
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
