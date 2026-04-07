import chalk from "chalk";
import type { ActionStatus } from "../types.js";

// ── String width (handles CJK double-width) ──────────────────

export function stringWidth(str: string): number {
  const stripped = stripAnsi(str);
  let width = 0;
  for (const char of stripped) {
    const code = char.codePointAt(0)!;
    if (isFullwidth(code)) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

function stripAnsi(str: string): string {
  return str.replace(
    // biome-ignore lint: ansi escape regex
    /[\u001b\u009b][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g,
    "",
  );
}

function isFullwidth(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3040 && code <= 0x309f) ||
    (code >= 0x30a0 && code <= 0x30ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff01 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x2fffd) ||
    (code >= 0x30000 && code <= 0x3fffd)
  );
}

// ── Color maps ───────────────────────────────────────────────

export function actionStyle(action: ActionStatus) {
  switch (action) {
    case "pending":
      return chalk.yellow;
    case "fix":
      return chalk.cyan;
    case "skip":
      return chalk.dim;
    case "done":
      return chalk.green;
  }
}

export function actionIcon(action: ActionStatus): string {
  switch (action) {
    case "pending":
      return chalk.yellow("●");
    case "fix":
      return chalk.cyan("◆");
    case "skip":
      return chalk.dim("○");
    case "done":
      return chalk.green("✔");
  }
}

export function actionLabel(action: ActionStatus): string {
  return actionStyle(action)(action);
}

export function typeLabel(type: string): string {
  switch (type) {
    case "thread":
      return chalk.bold.magenta("THREAD ");
    case "review":
      return chalk.bold.cyan("REVIEW ");
    case "issue_comment":
      return chalk.bold.blue("COMMENT");
    default:
      return chalk.bold(type.toUpperCase());
  }
}

export function prStateStyle(state: string): string {
  switch (state) {
    case "OPEN":
      return chalk.bgGreen.black.bold(` ${state} `);
    case "MERGED":
      return chalk.bgMagenta.white.bold(` ${state} `);
    case "CLOSED":
      return chalk.bgRed.white.bold(` ${state} `);
    default:
      return chalk.bold(state);
  }
}

export function reviewStateStyle(state: string): string {
  switch (state) {
    case "APPROVED":
      return chalk.green.bold(state);
    case "CHANGES_REQUESTED":
      return chalk.red.bold(state);
    case "COMMENTED":
      return chalk.yellow(state);
    case "DISMISSED":
      return chalk.dim(state);
    default:
      return state;
  }
}

// ── Box drawing ──────────────────────────────────────────────

export const BOX_WIDTH = 68;

export function drawBox(lines: string[]): string {
  // Calculate width based on content, with minimum
  const maxContent = Math.max(...lines.map((l) => stringWidth(l)));
  const width = Math.max(BOX_WIDTH, maxContent + 6);
  const inner = width - 2;

  const top = chalk.dim(`  ╭${"─".repeat(inner)}╮`);
  const bottom = chalk.dim(`  ╰${"─".repeat(inner)}╯`);
  const empty = chalk.dim("  │") + " ".repeat(inner) + chalk.dim("│");

  const contentLines = lines.map((line) => {
    const pad = inner - 2 - stringWidth(line);
    return (
      chalk.dim("  │") +
      `  ${line}` +
      " ".repeat(Math.max(0, pad)) +
      chalk.dim("│")
    );
  });

  return [top, empty, ...contentLines, empty, bottom].join("\n");
}

export function sectionHeader(title: string, count: number): string {
  const label = `${title} (${count})`;
  const line = "─".repeat(Math.max(0, BOX_WIDTH - stringWidth(label) - 5));
  return chalk.dim(`  ── ${chalk.bold.white(label)} ${line}`);
}

// ── Text processing ──────────────────────────────────────────

export function stripHtml(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<details>[\s\S]*?<\/details>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s*\n/gm, "\n");
}

export function extractSummary(body: string, maxLen = 72): string {
  const cleaned = stripHtml(body).trim();

  // Try to extract **bold** text first (common in structured review comments)
  const boldMatch = cleaned.match(/\*\*(.+?)\*\*/);
  if (boldMatch) {
    const text = boldMatch[1].trim();
    return text.length > maxLen ? `${text.substring(0, maxLen)}…` : text;
  }

  // Fall back to first non-empty line
  const firstLine =
    cleaned
      .split("\n")
      .find((l) => l.trim().length > 0)
      ?.trim() || "";
  return firstLine.length > maxLen
    ? `${firstLine.substring(0, maxLen)}…`
    : firstLine;
}

export function renderMarkdownBody(body: string): string {
  let text = stripHtml(body).trim();

  // Strip common noise patterns (Devin Review footer, etc.)
  text = text.replace(
    /---\s*\n\s*\*?Was this helpful\?[\s\S]*$/,
    "",
  );

  // Remove suggestion blocks (replace with indicator)
  text = text.replace(
    /```suggestion[\s\S]*?```/g,
    chalk.dim.italic("  [suggestion: see GitHub for diff]"),
  );

  // Style code blocks
  text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) => {
    return code
      .split("\n")
      .map((line: string) => chalk.dim(`    ${line}`))
      .join("\n");
  });

  // Style horizontal rules
  text = text.replace(/^---+$/gm, chalk.dim("─".repeat(40)));

  // Style inline code
  text = text.replace(/`([^`]+)`/g, (_m, code) => chalk.cyan(code));

  // Style bold
  text = text.replace(/\*\*(.+?)\*\*/g, (_m, content) => chalk.bold(content));

  // Style italic
  text = text.replace(
    /(?<!\*)\*([^*]+)\*(?!\*)/g,
    (_m, content) => chalk.italic(content),
  );

  // Word wrap long lines
  text = wrapLines(text, 76);

  // Clean up excessive blank lines
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.trim();

  return text;
}

function wrapLines(text: string, maxWidth: number): string {
  return text
    .split("\n")
    .flatMap((line) => {
      if (stringWidth(line) <= maxWidth) return [line];
      // Don't wrap lines that start with spaces (code blocks)
      if (line.startsWith("    ")) return [line];
      const words = line.split(" ");
      const wrapped: string[] = [];
      let current = "";
      for (const word of words) {
        const test = current ? `${current} ${word}` : word;
        if (stringWidth(test) > maxWidth && current) {
          wrapped.push(current);
          current = word;
        } else {
          current = test;
        }
      }
      if (current) wrapped.push(current);
      return wrapped;
    })
    .join("\n");
}

export function formatDate(dateStr: string): string {
  return chalk.dim(dateStr.substring(0, 10));
}

export function formatDateTime(dateStr: string): string {
  return chalk.dim(dateStr.substring(0, 16).replace("T", " "));
}
