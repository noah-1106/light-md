import "./styles.css";
import { EditorView, ViewUpdate } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { basicSetup } from "codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { marked } from "marked";
import hljs from "highlight.js";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { openUrl, openPath } from "@tauri-apps/plugin-opener";

marked.use({ breaks: true });

// ─── Types ───
interface Tab {
  id: string;
  filename: string;
  fullName: string;
  path: string | null;
  content: string;
  diskContent: string;
  modified: boolean;
}

// ─── State ───
let tabs: Tab[] = [];
let activeTabId: string | null = null;
let editor: EditorView;
let currentTheme: "light" | "dark" = window.matchMedia("(prefers-color-scheme: dark)").matches
  ? "dark"
  : "light";
const themeCompartment = new Compartment();
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let defaultFolder: string = "";
let tabCounter = 0;
const openedPaths = new Set<string>();

// ─── DOM refs ───
const editorPane = document.getElementById("editor-pane")!;
const previewContent = document.getElementById("preview-content")!;
const tabBar = document.getElementById("tab-bar")!;
const mainArea = document.getElementById("main-area")!;
const welcomeScreen = document.getElementById("welcome")!;
const statusPathEl = document.getElementById("status-path")!;
const statusInfoEl = document.getElementById("status-info")!;

// ─── Helpers ───
function genId() {
  return `tab-${++tabCounter}`;
}

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number) {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function getEffectiveTheme(): "light" | "dark" {
  return currentTheme;
}

function stripExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

function scanBlocks(content: string): number[] {
  const lines = content.split("\n");
  const blockLines: number[] = [];
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (trimmed === "") {
      i++;
      continue;
    }
    const start = i + 1; // 1-based line number
    if (trimmed.startsWith("#")) {
      blockLines.push(start);
      i++;
    } else if (trimmed.startsWith("```")) {
      blockLines.push(start);
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) i++;
      i++;
    } else if (trimmed.startsWith(">")) {
      blockLines.push(start);
      i++;
      while (i < lines.length && (lines[i].trim().startsWith(">") || lines[i].trim() === "")) i++;
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || /^\d+\.\s/.test(trimmed)) {
      blockLines.push(start);
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (l.trim() === "") {
          if (
            i + 1 < lines.length &&
            (lines[i + 1].trim().startsWith("- ") ||
              lines[i + 1].trim().startsWith("* ") ||
              /^\d+\.\s/.test(lines[i + 1].trim()) ||
              /^\s+\S/.test(lines[i + 1]))
          ) {
            i++;
            continue;
          }
          break;
        }
        if (
          l.trim().startsWith("- ") ||
          l.trim().startsWith("* ") ||
          /^\d+\.\s/.test(l.trim()) ||
          /^\s+/.test(l)
        ) {
          i++;
          continue;
        }
        break;
      }
    } else if (trimmed.startsWith("|")) {
      blockLines.push(start);
      i++;
      while (i < lines.length && lines[i].trim().startsWith("|")) i++;
    } else if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
      blockLines.push(start);
      i++;
    } else {
      // paragraph or other block
      blockLines.push(start);
      i++;
      while (i < lines.length && lines[i].trim() !== "") i++;
    }
  }
  return blockLines;
}

function getActiveTab(): Tab | undefined {
  return tabs.find((t) => t.id === activeTabId);
}

function makeFilenameFromContent(content: string): string {
  const lines = content.split("\n");
  let title = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Strip markdown heading syntax
    title = trimmed.replace(/^#{1,6}\s+/, "");
    // Strip inline markdown
    title = title
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/_(.+?)_/g, "$1")
      .replace(/`(.+?)`/g, "$1")
      .replace(/\[(.+?)\]\(.+?\)/g, "$1")
      .replace(/!\[.*?\]\(.+?\)/g, "")
      .trim();
    if (title) break;
  }
  if (!title) title = "\u672a\u547d\u540d";
  // Sanitize filename
  title = title
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  // Truncate
  if (title.length > 40) title = title.slice(0, 40).trim();
  return `${title}.md`;
}

// ─── UI Updates ───
function renderTabs() {
  tabBar.innerHTML = "";
  for (const tab of tabs) {
    const el = document.createElement("div");
    el.className = `tab${tab.id === activeTabId ? " active" : ""}${tab.modified ? " modified" : ""}`;
    el.dataset.id = tab.id;

    const dot = tab.modified ? '<span class="tab-dot">\u25cf</span>' : "";
    el.innerHTML = `${dot}<span class="tab-name">${escapeHtml(tab.filename)}</span><span class="tab-close">\u00d7</span>`;

    el.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).classList.contains("tab-close")) {
        closeTab(tab.id);
      } else {
        switchTab(tab.id);
      }
    });

    tabBar.appendChild(el);
  }
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function updateStatus(line: number, col: number) {
  const tab = getActiveTab();
  const chars = tab ? tab.content.length : 0;
  const words = tab ? tab.content.trim().split(/\s+/).filter(Boolean).length : 0;
  statusInfoEl.textContent = `${chars} \u5b57 | ${words} \u8bcd | \u884c ${line}, \u5217 ${col}`;
  statusPathEl.textContent = tab?.path ?? "-";
}

function showEditor() {
  welcomeScreen.style.display = "none";
  mainArea.style.display = "flex";
  tabBar.style.display = "flex";
}

function showWelcome() {
  welcomeScreen.style.display = "flex";
  mainArea.style.display = "none";
  tabBar.style.display = "none";
  statusPathEl.textContent = "-";
  statusInfoEl.textContent = "0 \u5b57 | \u884c 1, \u5217 1";
}

// ─── Auto Save ───
async function doSave() {
  const tab = getActiveTab();
  if (!tab) return;
  try {
    let path = tab.path;
    if (!path) {
      // New file: auto-generate filename from first line
      const filename = makeFilenameFromContent(tab.content);
      const safeName = filename.replace(/\//g, "_");
      path = defaultFolder ? `${defaultFolder}/${safeName}` : safeName;
      tab.path = path;
      tab.fullName = safeName;
      tab.filename = stripExt(safeName);
      await invoke("set_current_file", { path });
      renderTabs();
    }
    await invoke("write_file", { path, content: tab.content });
    tab.diskContent = tab.content;
    tab.modified = false;
    renderTabs();
  } catch (e) {
    console.error("auto save failed:", e);
  }
}

function scheduleAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(doSave, 1500);
}

// ─── Editor ───
function createEditorState(content: string): EditorState {
  const isDark = getEffectiveTheme() === "dark";
  return EditorState.create({
    doc: content,
    extensions: [
      basicSetup,
      markdown(),
      EditorView.lineWrapping,
      themeCompartment.of(isDark ? oneDark : []),
      EditorView.updateListener.of((update: ViewUpdate) => {
        if (update.docChanged) {
          const tab = getActiveTab();
          if (!tab) return;
          const text = update.state.doc.toString();
          tab.content = text;
          tab.modified = text !== tab.diskContent;
          renderTabs();
          previewRender(text);
          scheduleAutoSave();
        }
        if (update.selectionSet) {
          const pos = update.state.selection.main.head;
          const line = update.state.doc.lineAt(pos);
          updateStatus(line.number, pos - line.from + 1);
        }
      }),
    ],
  });
}

function initEditor() {
  if (editor) return;
  editor = new EditorView({ state: createEditorState(""), parent: editorPane });
  initImageDrop();
  initImagePaste();
}

// ─── Preview ───
const previewRender = debounce(async (content: string) => {
  const html = await marked.parse(content);
  previewContent.innerHTML = html;

  // Attach source line numbers to rendered blocks for scroll sync
  const blockLines = scanBlocks(content);
  const elements = Array.from(previewContent.children);
  for (let i = 0; i < Math.min(elements.length, blockLines.length); i++) {
    (elements[i] as HTMLElement).dataset.line = String(blockLines[i]);
  }

  previewContent.querySelectorAll("pre code").forEach((block) => {
    hljs.highlightElement(block as HTMLElement);
  });

  fixImageSrcs();
  attachLinkHandlers();
}, 200);

function resolveImagePath(src: string): string | null {
  if (!src || /^https?:|^data:/i.test(src)) return src;
  if (src.startsWith("/")) return src;
  if (src.startsWith("~")) {
    const home = defaultFolder.split("/Documents")[0];
    return src.replace("~", home);
  }
  const tab = getActiveTab();
  if (tab?.path) {
    const base = tab.path.slice(0, tab.path.lastIndexOf("/") + 1);
    return base + src;
  }
  return defaultFolder ? `${defaultFolder}/${src}` : src;
}

function fixImageSrcs() {
  previewContent.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src");
    if (!src) return;
    const abs = resolveImagePath(src);
    if (abs && abs !== src && !/^https?:|^data:/i.test(abs)) {
      img.src = convertFileSrc(abs);
    }
  });
}

function attachLinkHandlers() {
  previewContent.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      const href = a.getAttribute("href");
      if (!href) return;

      try {
        if (/^(https?:|mailto:|tel:)/i.test(href)) {
          await openUrl(href);
        } else {
          // Resolve relative path against document directory
          let resolved = href;
          if (!href.startsWith("/") && !href.startsWith("~")) {
            const tab = getActiveTab();
            if (tab?.path) {
              const base = tab.path.slice(0, tab.path.lastIndexOf("/") + 1);
              resolved = base + href;
            } else {
              resolved = defaultFolder ? `${defaultFolder}/${href}` : href;
            }
          }
          await openPath(resolved);
        }
      } catch (err) {
        console.error("open link failed:", err);
      }
    });
  });
}

// ─── Tab Operations ───
function newTab(content = "", path: string | null = null, fullName = "未命名.md") {
  const tab: Tab = {
    id: genId(),
    filename: stripExt(fullName),
    fullName,
    path,
    content,
    diskContent: content,
    modified: false,
  };
  tabs.push(tab);
  switchTab(tab.id);
  showEditor();
}

function switchTab(id: string) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;

  activeTabId = id;
  initEditor();
  editor.setState(createEditorState(tab.content));
  applyTheme();
  previewRender(tab.content);
  updateStatus(1, 1);
  renderTabs();
}

async function closeTab(id: string) {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const tab = tabs[idx];

  if (tab.modified) {
    const ok = confirm(`"${tab.filename}" \u5c1a\u672a\u4fdd\u5b58\uff0c\u786e\u5b9a\u5173\u95ed\uff1f`);
    if (!ok) return;
  }

  tabs.splice(idx, 1);

  if (activeTabId === id) {
    if (tabs.length > 0) {
      const nextIdx = Math.min(idx, tabs.length - 1);
      switchTab(tabs[nextIdx].id);
    } else {
      activeTabId = null;
      showWelcome();
      renderTabs();
    }
  } else {
    renderTabs();
  }
}

// ─── File I/O ───
async function openFileDialog() {
  const selected = await open({
    filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd"] }],
    multiple: true,
  });
  if (!selected) return;
  const paths = Array.isArray(selected) ? selected : [selected];
  for (const path of paths) {
    if (typeof path !== "string") continue;
    await loadFile(path);
  }
}

async function loadFile(path: string) {
  // 避免重复打开同一文件
  const existing = tabs.find((t) => t.path === path);
  if (existing) {
    switchTab(existing.id);
    return;
  }
  try {
    const content = await invoke<string>("read_file", { path });
    const [name] = await invoke<[string, number]>("get_file_info", { path });
    newTab(content, path, name);
  } catch (e) {
    alert(`\u6253\u5f00\u6587\u4ef6\u5931\u8d25: ${e}`);
  }
}

async function openDefaultFolder() {
  if (!defaultFolder) return;
  try {
    await invoke("open_folder", { path: defaultFolder });
  } catch (e) {
    console.error("open folder failed:", e);
  }
}

// ─── Image Insertion ───
function isImageFile(name: string): boolean {
  return /\.(png|jpg|jpeg|gif|svg|webp|bmp|ico|tiff?)$/i.test(name);
}

function generateImageFilename(ext: string): string {
  const timestamp = Date.now();
  const cleanExt = ext.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "png";
  return `image-${timestamp}.${cleanExt}`;
}

function getImageSaveDir(): string {
  const tab = getActiveTab();
  if (tab?.path) {
    const lastSlash = tab.path.lastIndexOf("/");
    const docDir = lastSlash >= 0 ? tab.path.slice(0, lastSlash) : defaultFolder;
    const docName = stripExt(tab.fullName) || "未命名";
    return `${docDir}/${docName}.images`;
  }
  return `${defaultFolder}/images`;
}

function getImagePathForMarkdown(savedPath: string): string {
  const tab = getActiveTab();
  if (tab?.path) {
    const docDir = tab.path.slice(0, tab.path.lastIndexOf("/") + 1);
    if (savedPath.startsWith(docDir)) {
      return savedPath.slice(docDir.length);
    }
  }
  if (defaultFolder && savedPath.startsWith(defaultFolder)) {
    const rel = savedPath.slice(defaultFolder.length);
    return rel.startsWith("/") ? `.${rel}` : `./${rel}`;
  }
  return savedPath;
}

async function saveImageToDisk(data: Uint8Array, filename: string): Promise<string | null> {
  const dir = getImageSaveDir();
  const path = `${dir}/${filename}`;
  try {
    await invoke("save_image", { path, data: Array.from(data) });
    return path;
  } catch (e) {
    console.error("save image failed:", e);
    return null;
  }
}

function insertImageMarkdown(savedPath: string, alt: string = "image") {
  const path = getImagePathForMarkdown(savedPath);
  const markdown = `![${alt}](${path})`;
  const pos = editor.state.selection.main.head;
  editor.dispatch({
    changes: { from: pos, insert: markdown },
  });
}

function initImageDrop() {
  const el = editor.dom;

  el.addEventListener("dragover", (e) => {
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    let hasImage = false;
    for (let i = 0; i < files.length; i++) {
      if (isImageFile(files[i].name)) {
        hasImage = true;
        break;
      }
    }
    if (!hasImage) return;
    e.preventDefault();
  });

  el.addEventListener("drop", async (e) => {
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    let hasImage = false;
    for (let i = 0; i < files.length; i++) {
      if (isImageFile(files[i].name)) {
        hasImage = true;
        break;
      }
    }
    if (!hasImage) return;

    e.preventDefault();
    e.stopPropagation();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!isImageFile(file.name)) continue;
      try {
        const buffer = await file.arrayBuffer();
        const ext = file.name.slice(file.name.lastIndexOf(".") + 1) || "png";
        const filename = generateImageFilename(ext);
        const savedPath = await saveImageToDisk(new Uint8Array(buffer), filename);
        if (savedPath) {
          const alt = file.name.slice(0, file.name.lastIndexOf(".")) || "image";
          insertImageMarkdown(savedPath, alt);
        }
      } catch (err) {
        console.error("drop image failed:", err);
      }
    }
  });
}

function initImagePaste() {
  const el = editor.dom;
  el.addEventListener("paste", async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    let hasImage = false;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        hasImage = true;
        break;
      }
    }
    if (!hasImage) return;

    e.preventDefault();
    e.stopPropagation();

    for (const item of Array.from(items)) {
      if (!item.type.startsWith("image/")) continue;
      const blob = item.getAsFile();
      if (!blob) continue;
      try {
        const buffer = await blob.arrayBuffer();
        const ext = item.type.split("/")[1] || "png";
        const filename = generateImageFilename(ext);
        const savedPath = await saveImageToDisk(new Uint8Array(buffer), filename);
        if (savedPath) {
          insertImageMarkdown(savedPath);
        }
      } catch (err) {
        console.error("paste image failed:", err);
      }
    }
  });
}

// ─── Splitter ───
function initSplitter() {
  const splitter = document.getElementById("splitter")!;
  let isDragging = false;

  splitter.addEventListener("mousedown", (e) => {
    isDragging = true;
    splitter.classList.add("dragging");
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const rect = mainArea.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    const clamped = Math.max(15, Math.min(85, pct));
    mainArea.style.setProperty("--editor-width", `${clamped}%`);
    mainArea.style.setProperty("--preview-width", `${100 - clamped}%`);
  });

  document.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      splitter.classList.remove("dragging");
    }
  });
}

// ─── Sync Scroll ───
function initSyncScroll() {
  const previewPane = document.getElementById("preview-pane")!;

  const tryInit = () => {
    if (!editor) {
      setTimeout(tryInit, 100);
      return;
    }
    const editorScroll = editor.scrollDOM;

    // One-way semantic sync: editor → preview only.
    // Map the top visible line in the editor to the nearest block element
    // in the preview (matched by source line number) for precise alignment.
    editorScroll.addEventListener("scroll", () => {
      const top = editorScroll.scrollTop + 8;
      const block = editor.lineBlockAtHeight(top);
      const line = editor.state.doc.lineAt(block.from).number;

      const elements = previewContent.querySelectorAll<HTMLElement>("[data-line]");
      let target: HTMLElement | null = null;
      for (const el of elements) {
        const elLine = parseInt(el.dataset.line!, 10);
        if (elLine <= line) {
          target = el;
        } else {
          break;
        }
      }

      if (target) {
        const maxScroll = previewPane.scrollHeight - previewPane.clientHeight;
        previewPane.scrollTop = Math.max(0, Math.min(target.offsetTop - 8, maxScroll));
      } else {
        // Fallback to proportional sync when no anchor is available
        const ratio =
          editorScroll.scrollTop /
          (editorScroll.scrollHeight - editorScroll.clientHeight || 1);
        previewPane.scrollTop =
          ratio * (previewPane.scrollHeight - previewPane.clientHeight);
      }
    });
  };

  tryInit();
}

// ─── Theme ───
function applyTheme() {
  const theme = getEffectiveTheme();
  document.documentElement.setAttribute("data-theme", theme);
  editor?.dispatch({
    effects: themeCompartment.reconfigure(theme === "dark" ? oneDark : []),
  });
}

function cycleTheme() {
  currentTheme = currentTheme === "light" ? "dark" : "light";
  localStorage.setItem("lightmd-theme", currentTheme);
  applyTheme();
}

// ─── Init ───
async function init() {
  const saved = localStorage.getItem("lightmd-theme");
  if (saved === "light" || saved === "dark") currentTheme = saved;
  applyTheme();

  // Get default folder from backend
  try {
    defaultFolder = await invoke<string>("get_default_folder");
  } catch (e) {
    defaultFolder = "";
  }

  // Handle file open from command line args (Rust backend)
  listen("open-file", (event) => {
    const path = event.payload as string;
    if (path && !openedPaths.has(path)) {
      openedPaths.add(path);
      loadFile(path);
    }
  });

  // Handle deep-link file open (macOS Finder double-click / Windows)
  async function handleDeepLinkUrls(urls: string[]) {
    for (const url of urls) {
      if (url.startsWith("file://")) {
        const path = decodeURIComponent(url.slice(7));
        if (path && !openedPaths.has(path)) {
          openedPaths.add(path);
          loadFile(path);
        }
      }
    }
  }

  try {
    // Register listener for when app is already running
    await onOpenUrl((urls) => handleDeepLinkUrls(urls));

    // Handle cold-start: URLs that arrived before listener was registered
    const currentUrls = await getCurrent();
    if (currentUrls) {
      handleDeepLinkUrls(currentUrls);
    }
  } catch (e) {
    console.error("deep link init failed:", e);
  }

  // Buttons
  document.getElementById("btn-new")!.addEventListener("click", () => newTab());
  document.getElementById("btn-open")!.addEventListener("click", openFileDialog);
  document.getElementById("btn-folder")!.addEventListener("click", openDefaultFolder);
  document.getElementById("btn-theme")!.addEventListener("click", cycleTheme);

  // Welcome screen
  document.getElementById("welcome-new")!.addEventListener("click", () => newTab());
  document.getElementById("welcome-open")!.addEventListener("click", openFileDialog);

  initSplitter();
  initSyncScroll();

  showWelcome();
}

window.addEventListener("DOMContentLoaded", init);
