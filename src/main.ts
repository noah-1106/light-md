import "katex/dist/katex.min.css";
import "./styles.css";
import { EditorView, ViewUpdate } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { basicSetup } from "codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import hljs from "highlight.js";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { openUrl, openPath } from "@tauri-apps/plugin-opener";
import { renderMarkdown, scanBlocks } from "./markdown";
import {
  directoryName,
  formatImageMarkdown,
  joinPath,
  relativePathWithin,
  resolveImagePath,
} from "./file-path";

// ─── Types ───
interface FileRevision {
  modifiedSecs: number;
  modifiedNanos: number;
  size: number;
}

interface FileSnapshot {
  name: string;
  content: string;
  revision: FileRevision;
}

interface FileInfo {
  name: string;
  revision: FileRevision;
}

type WriteFileResult =
  | { status: "saved"; revision: FileRevision }
  | { status: "conflict"; actualRevision: FileRevision | null };

interface FileConflict {
  kind: "changed" | "deleted";
  observedRevision: FileRevision | null;
}

interface Tab {
  id: string;
  filename: string;
  fullName: string;
  path: string | null;
  content: string;
  diskContent: string;
  diskRevision: FileRevision | null;
  modified: boolean;
  editVersion: number;
  autoSaveTimer: ReturnType<typeof setTimeout> | null;
  saveInFlight: boolean;
  saveQueued: boolean;
  pollInFlight: boolean;
  reloadInFlight: boolean;
  conflict: FileConflict | null;
}

// ─── State ───
let tabs: Tab[] = [];
let activeTabId: string | null = null;
let editor: EditorView;
let currentTheme: "light" | "dark" = window.matchMedia("(prefers-color-scheme: dark)").matches
  ? "dark"
  : "light";
const themeCompartment = new Compartment();
const fontSizeCompartment = new Compartment();
let defaultFolder: string = "";
let tabCounter = 0;
let previewGeneration = 0;
let applyingProgrammaticUpdate = false;
let zoomLevel = 1.0;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.1;

// ─── DOM refs ───
const editorPane = document.getElementById("editor-pane")!;
const previewContent = document.getElementById("preview-content")!;
const tabBar = document.getElementById("tab-bar")!;
const mainArea = document.getElementById("main-area")!;
const welcomeScreen = document.getElementById("welcome")!;
const statusPathEl = document.getElementById("status-path")!;
const statusInfoEl = document.getElementById("status-info")!;
const conflictBanner = document.getElementById("sync-conflict")!;
const conflictMessage = document.getElementById("conflict-message")!;
const conflictReloadButton = document.getElementById("conflict-reload") as HTMLButtonElement;
const conflictOverwriteButton = document.getElementById("conflict-overwrite") as HTMLButtonElement;

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

function getActiveTab(): Tab | undefined {
  return tabs.find((t) => t.id === activeTabId);
}

function getTab(id: string): Tab | undefined {
  return tabs.find((tab) => tab.id === id);
}

function revisionsEqual(a: FileRevision | null, b: FileRevision | null): boolean {
  if (!a || !b) return a === b;
  return a.modifiedSecs === b.modifiedSecs &&
    a.modifiedNanos === b.modifiedNanos &&
    a.size === b.size;
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

function getEditorFontSizeExtension() {
  const size = 14.5 * zoomLevel;
  return EditorView.theme({
    ".cm-content": { fontSize: `${size}px` },
    ".cm-gutters": { fontSize: `${size}px` },
  });
}

function applyZoom() {
  const previewSize = 15.5 * zoomLevel;
  document.documentElement.style.setProperty("--preview-font-size", `${previewSize}px`);

  if (editor) {
    editor.dispatch({
      effects: fontSizeCompartment.reconfigure(getEditorFontSizeExtension()),
    });
  }
}

function zoomIn() {
  zoomLevel = Math.min(MAX_ZOOM, zoomLevel + ZOOM_STEP);
  applyZoom();
  localStorage.setItem("lightmd-zoom", String(zoomLevel));
  const tab = getActiveTab();
  if (tab) {
    const pos = editor.state.selection.main.head;
    const line = editor.state.doc.lineAt(pos);
    updateStatus(line.number, pos - line.from + 1);
  } else {
    updateStatus(1, 1);
  }
}

function zoomOut() {
  zoomLevel = Math.max(MIN_ZOOM, zoomLevel - ZOOM_STEP);
  applyZoom();
  localStorage.setItem("lightmd-zoom", String(zoomLevel));
  const tab = getActiveTab();
  if (tab) {
    const pos = editor.state.selection.main.head;
    const line = editor.state.doc.lineAt(pos);
    updateStatus(line.number, pos - line.from + 1);
  } else {
    updateStatus(1, 1);
  }
}

function zoomReset() {
  zoomLevel = 1.0;
  applyZoom();
  localStorage.setItem("lightmd-zoom", String(zoomLevel));
  const tab = getActiveTab();
  if (tab) {
    const pos = editor.state.selection.main.head;
    const line = editor.state.doc.lineAt(pos);
    updateStatus(line.number, pos - line.from + 1);
  } else {
    updateStatus(1, 1);
  }
}

function updateStatus(line: number, col: number) {
  const tab = getActiveTab();
  const chars = tab ? tab.content.length : 0;
  const words = tab ? tab.content.trim().split(/\s+/).filter(Boolean).length : 0;
  statusInfoEl.textContent = `${Math.round(zoomLevel * 100)}% | ${chars} \u5b57 | ${words} \u8bcd | \u884c ${line}, \u5217 ${col}`;
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
  updateStatus(1, 1);
  updateConflictBanner();
}

// ─── Auto Save & External Changes ───
function updateConflictBanner() {
  const tab = getActiveTab();
  const conflict = tab?.conflict;
  conflictBanner.hidden = !conflict;
  if (!tab || !conflict) return;

  conflictMessage.textContent = conflict.kind === "deleted"
    ? `“${tab.filename}” 已在磁盘中被删除，编辑内容仍保留。自动保存已暂停。`
    : `“${tab.filename}” 的磁盘版本与当前编辑冲突。自动保存已暂停。`;
  const busy = tab.saveInFlight || tab.reloadInFlight;
  conflictReloadButton.disabled = busy || conflict.kind === "deleted";
  conflictOverwriteButton.disabled = busy;
  conflictReloadButton.textContent = "从磁盘重新加载";
  conflictOverwriteButton.textContent = conflict.kind === "deleted"
    ? "从编辑器重新创建"
    : "用当前内容覆盖磁盘";
}

function markConflict(tab: Tab, observedRevision: FileRevision | null) {
  if (tab.autoSaveTimer) {
    clearTimeout(tab.autoSaveTimer);
    tab.autoSaveTimer = null;
  }
  tab.saveQueued = false;
  tab.modified = true;
  tab.conflict = {
    kind: observedRevision ? "changed" : "deleted",
    observedRevision,
  };
  renderTabs();
  updateConflictBanner();
}

function scheduleAutoSave(tabId: string, contentSnapshot: string) {
  const tab = getTab(tabId);
  if (!tab || tab.conflict) return;
  if (tab.autoSaveTimer) clearTimeout(tab.autoSaveTimer);
  if (tab.saveInFlight) {
    tab.saveQueued = true;
    return;
  }
  tab.autoSaveTimer = setTimeout(() => {
    tab.autoSaveTimer = null;
    void saveTab(tabId, contentSnapshot, tab.diskRevision);
  }, 1500);
}

async function saveTab(
  tabId: string,
  contentSnapshot: string,
  expectedRevision: FileRevision | null,
  resolveConflict = false,
) {
  const initialTab = getTab(tabId);
  if (!initialTab || (initialTab.conflict && !resolveConflict)) return;
  if (initialTab.saveInFlight) {
    initialTab.saveQueued = true;
    return;
  }
  if (initialTab.content !== contentSnapshot) {
    if (initialTab.modified && !initialTab.conflict) scheduleAutoSave(tabId, initialTab.content);
    return;
  }

  initialTab.saveInFlight = true;
  initialTab.saveQueued = false;
  updateConflictBanner();

  try {
    let path = initialTab.path;
    if (!path) {
      // New file: auto-generate filename from first line
      const filename = makeFilenameFromContent(initialTab.content);
      const safeName = filename.replace(/\//g, "_");
      path = joinPath(defaultFolder, safeName);
      initialTab.path = path;
      initialTab.fullName = safeName;
      initialTab.filename = stripExt(safeName);
      await invoke("set_current_file", { path });
      renderTabs();
    }

    const result = await invoke<WriteFileResult>("write_file", {
      path,
      content: contentSnapshot,
      expectedRevision,
    });
    const tab = getTab(tabId);
    if (!tab) return;

    if (result.status === "saved") {
      tab.diskContent = contentSnapshot;
      tab.diskRevision = result.revision;
      tab.modified = tab.content !== contentSnapshot;
      if (resolveConflict) tab.conflict = null;
      renderTabs();
    } else {
      markConflict(tab, result.actualRevision);
    }
  } catch (e) {
    console.error("auto save failed:", e);
    const tab = getTab(tabId);
    if (tab) tab.modified = true;
    if (resolveConflict) alert(`保存失败: ${e}`);
  } finally {
    const tab = getTab(tabId);
    if (tab) {
      tab.saveInFlight = false;
      const needsTrailingSave = tab.saveQueued ||
        (tab.modified && tab.content !== contentSnapshot && !tab.conflict);
      tab.saveQueued = false;
      if (needsTrailingSave && !tab.conflict) scheduleAutoSave(tab.id, tab.content);
      renderTabs();
      updateConflictBanner();
    }
  }
}

async function overwriteConflict(tabId: string) {
  const initialTab = getTab(tabId);
  if (!initialTab?.path || !initialTab.conflict ||
      initialTab.saveInFlight || initialTab.reloadInFlight) return;
  const path = initialTab.path;
  initialTab.reloadInFlight = true;
  updateConflictBanner();

  try {
    const info = await invoke<FileInfo | null>("get_file_info", { path });
    const tab = getTab(tabId);
    if (!tab?.conflict || tab.path !== path) return;
    tab.conflict = {
      kind: info ? "changed" : "deleted",
      observedRevision: info?.revision ?? null,
    };
    tab.reloadInFlight = false;
    await saveTab(tab.id, tab.content, tab.conflict.observedRevision, true);
  } catch (e) {
    console.error("conflict resolution failed:", e);
    alert(`保存失败: ${e}`);
  } finally {
    const tab = getTab(tabId);
    if (tab) {
      tab.reloadInFlight = false;
      updateConflictBanner();
    }
  }
}

async function reloadTabFromDisk(tabId: string, mode: "clean" | "conflict") {
  const initialTab = getTab(tabId);
  if (!initialTab?.path || initialTab.reloadInFlight || initialTab.saveInFlight) return;
  if (mode === "clean" && (initialTab.modified || initialTab.conflict)) return;
  if (mode === "conflict" && !initialTab.conflict) return;

  const path = initialTab.path;
  const baselineRevision = initialTab.diskRevision;
  const startingContent = initialTab.content;
  const startingVersion = initialTab.editVersion;
  if (initialTab.autoSaveTimer) {
    clearTimeout(initialTab.autoSaveTimer);
    initialTab.autoSaveTimer = null;
  }
  initialTab.saveQueued = false;
  initialTab.reloadInFlight = true;
  updateConflictBanner();

  try {
    const snapshot = await invoke<FileSnapshot>("read_file", { path });
    const tab = getTab(tabId);
    if (!tab || tab.path !== path) return;

    const localChanged = tab.content !== startingContent || tab.editVersion !== startingVersion;
    const baselineChanged = !revisionsEqual(tab.diskRevision, baselineRevision);
    if ((mode === "clean" && (localChanged || baselineChanged || tab.saveInFlight)) ||
        (mode === "conflict" && localChanged)) {
      if (localChanged || tab.modified) markConflict(tab, snapshot.revision);
      return;
    }

    const previewTop = activeTabId === tab.id
      ? document.getElementById("preview-pane")!.scrollTop
      : null;
    tab.content = snapshot.content;
    tab.diskContent = snapshot.content;
    tab.diskRevision = snapshot.revision;
    tab.fullName = snapshot.name;
    tab.filename = stripExt(snapshot.name);
    tab.modified = false;
    tab.conflict = null;
    tab.editVersion++;

    if (activeTabId === tab.id) {
      installActiveEditor(tab, true);
      schedulePreviewRender(tab, previewTop ?? undefined);
      const pos = editor.state.selection.main.head;
      const line = editor.state.doc.lineAt(pos);
      updateStatus(line.number, pos - line.from + 1);
    }
    renderTabs();
  } catch (e) {
    console.error("reload failed:", e);
    if (mode === "conflict") alert(`重新加载失败: ${e}`);
  } finally {
    const tab = getTab(tabId);
    if (tab) {
      tab.reloadInFlight = false;
      updateConflictBanner();
    }
  }
}

async function checkExternalFile(tabId: string) {
  const tab = getTab(tabId);
  if (!tab?.path || !tab.diskRevision || tab.conflict ||
      tab.saveInFlight || tab.pollInFlight || tab.reloadInFlight) return;

  const path = tab.path;
  const baselineRevision = tab.diskRevision;
  const startingVersion = tab.editVersion;
  tab.pollInFlight = true;

  try {
    const info = await invoke<FileInfo | null>("get_file_info", { path });
    const current = getTab(tabId);
    if (!current || current.path !== path ||
        !revisionsEqual(current.diskRevision, baselineRevision)) return;

    if (!info) {
      markConflict(current, null);
      return;
    }
    if (revisionsEqual(info.revision, baselineRevision)) return;
    if (current.modified || current.editVersion !== startingVersion || current.saveInFlight) {
      markConflict(current, info.revision);
      return;
    }
    await reloadTabFromDisk(tabId, "clean");
  } catch (e) {
    console.error("external change check failed:", e);
  } finally {
    const current = getTab(tabId);
    if (current) current.pollInFlight = false;
  }
}

// ─── Editor ───
function createEditorState(content: string, tabId: string): EditorState {
  const isDark = getEffectiveTheme() === "dark";
  return EditorState.create({
    doc: content,
    extensions: [
      basicSetup,
      markdown(),
      EditorView.lineWrapping,
      themeCompartment.of(isDark ? oneDark : []),
      fontSizeCompartment.of(getEditorFontSizeExtension()),
      EditorView.updateListener.of((update: ViewUpdate) => {
        const tab = getTab(tabId);
        if (!tab) return;
        if (update.docChanged && !applyingProgrammaticUpdate) {
          const text = update.state.doc.toString();
          tab.content = text;
          tab.editVersion++;
          tab.modified = text !== tab.diskContent;
          renderTabs();
          if (activeTabId === tabId) schedulePreviewRender(tab);
          if (!tab.conflict) scheduleAutoSave(tabId, text);
        }
        if (update.selectionSet && activeTabId === tabId) {
          const pos = update.state.selection.main.head;
          const line = update.state.doc.lineAt(pos);
          updateStatus(line.number, pos - line.from + 1);
        }
      }),
    ],
  });
}

function initEditor(tabId: string) {
  if (editor) return;
  editor = new EditorView({ state: createEditorState("", tabId), parent: editorPane });
  initImageDrop();
  initImagePaste();
}

function installActiveEditor(tab: Tab, preserveView: boolean) {
  initEditor(tab.id);
  const cursor = preserveView ? editor.state.selection.main.head : 0;
  const scrollTop = preserveView ? editor.scrollDOM.scrollTop : 0;
  applyingProgrammaticUpdate = true;
  try {
    editor.setState(createEditorState(tab.content, tab.id));
    if (preserveView) {
      editor.dispatch({ selection: { anchor: Math.min(cursor, tab.content.length) } });
    }
  } finally {
    applyingProgrammaticUpdate = false;
  }
  editor.scrollDOM.scrollTop = scrollTop;
  applyTheme();

  if (preserveView) {
    const version = tab.editVersion;
    requestAnimationFrame(() => {
      if (activeTabId === tab.id && tab.editVersion === version) {
        editor.scrollDOM.scrollTop = scrollTop;
      }
    });
  }
}

// ─── Preview ───
function schedulePreviewRender(tab: Tab, restorePreviewScroll?: number) {
  const generation = ++previewGeneration;
  previewRender(tab.content, tab.id, tab.path, generation, restorePreviewScroll);
}

const previewRender = debounce(async (
  content: string,
  tabId: string,
  documentPath: string | null,
  generation: number,
  restorePreviewScroll?: number,
) => {
  const html = await renderMarkdown(content);
  if (generation !== previewGeneration || activeTabId !== tabId) return;
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

  fixImageSrcs(documentPath);
  attachLinkHandlers();
  if (restorePreviewScroll !== undefined) {
    document.getElementById("preview-pane")!.scrollTop = restorePreviewScroll;
  }
}, 200);

function getImageUrl(absPath: string): string {
  return convertFileSrc(absPath, "lightmd");
}

function fixImageSrcs(documentPath: string | null) {
  previewContent.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src");
    if (!src) return;
    const abs = resolveImagePath(src, documentPath, defaultFolder);
    if (abs) img.src = getImageUrl(abs);
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
function newTab(
  content = "",
  path: string | null = null,
  fullName = "未命名.md",
  diskRevision: FileRevision | null = null,
) {
  const tab: Tab = {
    id: genId(),
    filename: stripExt(fullName),
    fullName,
    path,
    content,
    diskContent: content,
    diskRevision,
    modified: false,
    editVersion: 0,
    autoSaveTimer: null,
    saveInFlight: false,
    saveQueued: false,
    pollInFlight: false,
    reloadInFlight: false,
    conflict: null,
  };
  tabs.push(tab);
  switchTab(tab.id);
  showEditor();
}

function switchTab(id: string) {
  const tab = getTab(id);
  if (!tab) return;

  activeTabId = id;
  installActiveEditor(tab, false);
  schedulePreviewRender(tab);
  updateStatus(1, 1);
  renderTabs();
  updateConflictBanner();
  void checkExternalFile(id);
}

async function closeTab(id: string) {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const tab = tabs[idx];

  if (tab.modified) {
    const ok = confirm(`"${tab.filename}" \u5c1a\u672a\u4fdd\u5b58\uff0c\u786e\u5b9a\u5173\u95ed\uff1f`);
    if (!ok) return;
  }

  if (tab.autoSaveTimer) clearTimeout(tab.autoSaveTimer);
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
    const snapshot = await invoke<FileSnapshot>("read_file", { path });
    newTab(snapshot.content, path, snapshot.name, snapshot.revision);
  } catch (e) {
    alert(`\u6253\u5f00\u6587\u4ef6\u5931\u8d25: ${e}`);
  }
}

async function openActiveFolder() {
  const tab = getActiveTab();
  const documentFolder = tab?.path ? directoryName(tab.path) : "";
  const folder = documentFolder || defaultFolder;
  if (!folder) return;
  try {
    await invoke("open_folder", { path: folder });
  } catch (e) {
    console.error("open folder failed:", e);
  }
}

async function initDefaultFolder() {
  try {
    defaultFolder = await invoke<string>("get_default_folder");
  } catch (e) {
    defaultFolder = "";
  }

  if (defaultFolder) return;

  let chosen: string | null = null;
  try {
    const suggested = await invoke<string>("get_suggested_default_folder");
    chosen = await open({
      directory: true,
      defaultPath: suggested,
    });
  } catch (e) {
    console.error("folder picker failed:", e);
  }

  if (chosen) {
    try {
      await invoke("set_default_folder", { path: chosen });
      defaultFolder = chosen;
    } catch (e) {
      console.error("set default folder failed:", e);
    }
  }

  if (!defaultFolder) {
    try {
      defaultFolder = await invoke<string>("get_container_documents_folder");
    } catch (e) {
      console.error("container documents folder failed:", e);
      defaultFolder = "";
    }
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
    const docDir = directoryName(tab.path) || defaultFolder;
    const docName = stripExt(tab.fullName) || "未命名";
    return joinPath(docDir, `${docName}.images`);
  }
  return joinPath(defaultFolder, "images");
}

function getImagePathForMarkdown(savedPath: string): string {
  const tab = getActiveTab();
  if (tab?.path) {
    const relative = relativePathWithin(savedPath, directoryName(tab.path));
    if (relative !== null) return relative;
  }
  const relativeToDefault = relativePathWithin(savedPath, defaultFolder);
  return relativeToDefault !== null ? `./${relativeToDefault}` : savedPath;
}

async function saveImageToDisk(data: Uint8Array, filename: string): Promise<string | null> {
  const dir = getImageSaveDir();
  const path = joinPath(dir, filename);
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
  const markdown = formatImageMarkdown(path, alt);
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
        const offsetTop = target.offsetTop - previewPane.offsetTop;
        previewPane.scrollTop = Math.max(0, Math.min(offsetTop - 8, maxScroll));
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

  // Restore zoom
  const savedZoom = localStorage.getItem("lightmd-zoom");
  if (savedZoom) {
    const parsed = parseFloat(savedZoom);
    if (!isNaN(parsed) && parsed >= MIN_ZOOM && parsed <= MAX_ZOOM) {
      zoomLevel = parsed;
      applyZoom();
    }
  }

  // Get default folder from backend
  listen("request-default-folder", async () => {
    await initDefaultFolder();
  });

  await initDefaultFolder();

  // Handle file open from command line args (Rust backend)
  listen("open-file", async (event) => {
    const path = event.payload as string;
    if (path) {
      await invoke("show_and_focus_window");
      loadFile(path);
    }
  });

  // Handle deep-link file open (macOS Finder double-click / Windows)
  async function handleDeepLinkUrls(urls: string[]) {
    for (const url of urls) {
      if (url.startsWith("file://")) {
        const path = decodeURIComponent(url.slice(7));
        if (path) {
          await invoke("show_and_focus_window");
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
  document.getElementById("btn-folder")!.addEventListener("click", openActiveFolder);
  document.getElementById("btn-theme")!.addEventListener("click", cycleTheme);
  conflictReloadButton.addEventListener("click", () => {
    const tab = getActiveTab();
    if (tab?.conflict) void reloadTabFromDisk(tab.id, "conflict");
  });
  conflictOverwriteButton.addEventListener("click", () => {
    const tab = getActiveTab();
    if (tab?.conflict) void overwriteConflict(tab.id);
  });

  const checkActiveFile = () => {
    if (activeTabId) void checkExternalFile(activeTabId);
  };
  window.addEventListener("focus", checkActiveFile);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkActiveFile();
  });
  window.setInterval(checkActiveFile, 2000);

  // Welcome screen
  document.getElementById("welcome-new")!.addEventListener("click", () => newTab());
  document.getElementById("welcome-open")!.addEventListener("click", openFileDialog);

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    const isMod = e.metaKey || e.ctrlKey;
    if (!isMod) return;
    if (e.key === "=" || e.key === "+") {
      e.preventDefault();
      zoomIn();
    } else if (e.key === "-") {
      e.preventDefault();
      zoomOut();
    } else if (e.key === "0") {
      e.preventDefault();
      zoomReset();
    }
  });

  initSplitter();
  initSyncScroll();

  showWelcome();
}

window.addEventListener("DOMContentLoaded", init);
