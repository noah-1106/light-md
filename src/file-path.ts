export function directoryName(path: string): string {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (separator < 0) return "";
  if (separator === 0) return path[0] === "/" ? "/" : "";
  if (separator === 2 && /^[A-Za-z]:/.test(path)) return path.slice(0, 3);
  return path.slice(0, separator);
}

export function joinPath(base: string, relative: string): string {
  if (!base) return relative;
  const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return `${base.replace(/[\\/]$/, "")}${separator}${relative}`;
}

export function relativePathWithin(path: string, directory: string): string | null {
  if (!directory) return null;
  const separator = directory.includes("\\") && !directory.includes("/") ? "\\" : "/";
  const prefix = directory.endsWith("/") || directory.endsWith("\\")
    ? directory
    : `${directory}${separator}`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || path.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(path);
}

function decodeOnce(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function decodeLocalSource(src: string): string {
  if (!/^file:/i.test(src)) return decodeOnce(src);
  try {
    const url = new URL(src);
    let path = decodeOnce(url.pathname);
    if (/^\/[A-Za-z]:[\\/]/.test(path)) path = path.slice(1);
    return url.host && url.host !== "localhost" ? `//${url.host}${path}` : path;
  } catch {
    return decodeOnce(src);
  }
}

export function resolveImagePath(
  src: string,
  documentPath: string | null,
  defaultFolder: string,
): string | null {
  if (!src || /^(?:https?:|data:|lightmd:|blob:)/i.test(src)) return null;

  const decoded = decodeLocalSource(src);
  if (decoded.startsWith("~") || isAbsolutePath(decoded)) return decoded;

  const base = documentPath ? directoryName(documentPath) : defaultFolder;
  return joinPath(base, decoded);
}

function escapeDestination(path: string): string {
  return path
    .replace(/%/g, "%25")
    .replace(/\\/g, "%5C")
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
}

export function formatImageMarkdown(path: string, alt = "image"): string {
  const escapedAlt = alt.replace(/\\/g, "\\\\").replace(/([\[\]])/g, "\\$1").replace(/[\r\n]+/g, " ");
  return `![${escapedAlt}](<${escapeDestination(path)}>)`;
}
