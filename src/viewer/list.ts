import chalk from "chalk";
import type {
  OutputEntry,
  PRMeta,
  ActionStatus,
  ThreadEntry,
  ReviewEntry,
  IssueCommentEntry,
} from "../types.js";
import {
  drawBox,
  sectionHeader,
  prStateStyle,
  typeLabel,
  actionIcon,
  actionLabel,
  actionStyle,
  reviewStateStyle,
  extractSummary,
  formatDate,
} from "./style.js";

const ACTION_ORDER: ActionStatus[] = ["pending", "fix", "skip", "done"];

export function renderList(entries: OutputEntry[], meta: PRMeta): void {
  const lines: string[] = [];

  // ── PR Header Box ──
  lines.push(
    drawBox([
      `${chalk.bold.cyan(`PR #${meta.number}`)}  ${prStateStyle(meta.state)}`,
      chalk.bold(meta.title),
      chalk.dim(`${meta.baseRefName} ← ${meta.headRefName}`),
    ]),
  );
  lines.push("");

  // ── Status summary ──
  const counts = new Map<ActionStatus, number>();
  for (const a of ACTION_ORDER) counts.set(a, 0);
  for (const e of entries) counts.set(e.action, (counts.get(e.action) ?? 0) + 1);

  const summary = ACTION_ORDER.map((a) => {
    const icon = actionIcon(a);
    const label = actionLabel(a);
    const count = chalk.bold(String(counts.get(a)));
    return `${icon} ${label} ${count}`;
  }).join("    ");
  lines.push(`  ${summary}`);
  lines.push("");

  // ── Grouped entries ──
  for (const action of ACTION_ORDER) {
    const group = entries.filter((e) => e.action === action);
    if (group.length === 0) continue;

    lines.push(sectionHeader(action.charAt(0).toUpperCase() + action.slice(1), group.length));
    lines.push("");

    for (const entry of group) {
      lines.push(...renderEntryCard(entry));
      lines.push("");
    }
  }

  console.log(lines.join("\n"));
}

function renderEntryCard(entry: OutputEntry): string[] {
  switch (entry.type) {
    case "thread":
      return renderThreadCard(entry);
    case "review":
      return renderReviewCard(entry);
    case "issue_comment":
      return renderCommentCard(entry);
  }
}

function renderThreadCard(entry: ThreadEntry): string[] {
  const lines: string[] = [];
  const color = actionStyle(entry.action);
  const bar = color("┃");

  // Header line: TYPE  ● status                    ID
  const header = `  ${typeLabel(entry.type)}  ${actionIcon(entry.action)} ${actionLabel(entry.action)}`;
  const id = chalk.dim(entry.id);
  lines.push(`${header}  ${id}`);

  // File path
  if (entry.path) {
    const loc = entry.line ? `${entry.path}:${entry.line}` : entry.path;
    lines.push(`  ${bar} ${chalk.underline.cyan(loc)}`);
  }

  // Author & date
  const firstComment = entry.comments[0];
  if (firstComment) {
    const author = firstComment.author
      ? chalk.bold(`@${firstComment.author}`)
      : chalk.dim("(unknown)");
    const date = formatDate(firstComment.created_at);
    const resolved = entry.is_resolved ? chalk.green(" ✔ resolved") : "";
    lines.push(`  ${bar} ${author}  ${date}${resolved}`);
  }

  // Body summary
  if (firstComment) {
    const summary = extractSummary(firstComment.body);
    if (summary) {
      lines.push(`  ${bar} ${summary}`);
    }
  }

  return lines;
}

function renderReviewCard(entry: ReviewEntry): string[] {
  const lines: string[] = [];
  const color = actionStyle(entry.action);
  const bar = color("┃");

  // Header
  const header = `  ${typeLabel(entry.type)}  ${actionIcon(entry.action)} ${actionLabel(entry.action)}`;
  const id = chalk.dim(entry.id);
  lines.push(`${header}  ${id}`);

  // Author & state
  const author = entry.author
    ? chalk.bold(`@${entry.author}`)
    : chalk.dim("(unknown)");
  const state = reviewStateStyle(entry.state);
  lines.push(`  ${bar} ${author}  ${state}`);

  // Body summary
  if (entry.body) {
    const summary = extractSummary(entry.body);
    if (summary) {
      lines.push(`  ${bar} ${summary}`);
    }
  }

  return lines;
}

function renderCommentCard(entry: IssueCommentEntry): string[] {
  const lines: string[] = [];
  const color = actionStyle(entry.action);
  const bar = color("┃");

  // Header
  const header = `  ${typeLabel(entry.type)}  ${actionIcon(entry.action)} ${actionLabel(entry.action)}`;
  const id = chalk.dim(entry.id);
  lines.push(`${header}  ${id}`);

  // Author
  const author = entry.author
    ? chalk.bold(`@${entry.author}`)
    : chalk.dim("(unknown)");
  lines.push(`  ${bar} ${author}`);

  // Body summary
  if (entry.body) {
    const summary = extractSummary(entry.body);
    if (summary) {
      lines.push(`  ${bar} ${summary}`);
    }
  }

  return lines;
}
