import katex from "katex";
import { Marked, type RendererExtension, type TokenizerExtension, type Tokens } from "marked";
import markedKatex from "marked-katex-extension";

const parser = new Marked({ breaks: true });
parser.use(markedKatex({ throwOnError: false, nonStandard: true }));

function renderLatex(token: Tokens.Generic): string {
  return katex.renderToString(token.text, {
    throwOnError: false,
    displayMode: Boolean(token.displayMode),
  });
}

const inlineLatexRule = /^\\(?:\(([^\n]*?)\\\)|\[([\s\S]*?)\\\])/;
const blockLatexRule = /^\\\[\n([\s\S]*?)\n\\\](?:\n|$)/;

const inlineLatex: TokenizerExtension & RendererExtension = {
  name: "inlineLatex",
  level: "inline",
  start(src: string) {
    const candidates = [src.indexOf("\\("), src.indexOf("\\[")].filter((index) => index >= 0);
    return candidates.length > 0 ? Math.min(...candidates) : undefined;
  },
  tokenizer(src: string) {
    const match = src.match(inlineLatexRule);
    if (!match) return;
    return {
      type: "inlineLatex",
      raw: match[0],
      text: (match[1] ?? match[2]).trim(),
      displayMode: match[2] !== undefined,
    };
  },
  renderer: renderLatex,
};

const blockLatex: TokenizerExtension & RendererExtension = {
  name: "blockLatex",
  level: "block",
  tokenizer(src: string) {
    const match = src.match(blockLatexRule);
    if (!match) return;
    return {
      type: "blockLatex",
      raw: match[0],
      text: match[1].trim(),
      displayMode: true,
    };
  },
  renderer(token: Tokens.Generic) {
    return `${renderLatex(token)}\n`;
  },
};

parser.use({ extensions: [blockLatex, inlineLatex] });

export async function renderMarkdown(content: string): Promise<string> {
  return parser.parse(content);
}

export function scanBlocks(content: string): number[] {
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
    const fence = trimmed.match(/^(`{3,}|~{3,})/);
    if (trimmed.startsWith("#")) {
      blockLines.push(start);
      i++;
    } else if (fence) {
      const marker = fence[1][0];
      const minimumLength = fence[1].length;
      blockLines.push(start);
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(marker.repeat(minimumLength))) i++;
      i++;
    } else if (trimmed === "$$" || trimmed === "\\[") {
      const closing = trimmed === "$$" ? "$$" : "\\]";
      blockLines.push(start);
      i++;
      while (i < lines.length && lines[i].trim() !== closing) i++;
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
