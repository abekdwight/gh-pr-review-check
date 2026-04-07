import chalk from "chalk";
import type {
  OutputEntry,
  PRMeta,
  ThreadEntry,
  ReviewEntry,
  IssueCommentEntry,
} from "../types.js";
import {
  drawBox,
  typeLabel,
  actionIcon,
  actionLabel,
  actionStyle,
  reviewStateStyle,
  renderMarkdownBody,
  formatDateTime,
} from "./style.js";

export function renderDetail(entry: OutputEntry, _meta: PRMeta): void {
  const lines: string[] = [];

  switch (entry.type) {
    case "thread":
      lines.push(...renderThreadDetail(entry));
      break;
    case "review":
      lines.push(...renderReviewDetail(entry));
      break;
    case "issue_comment":
      lines.push(...renderCommentDetail(entry));
      break;
  }

  console.log(lines.join("\n"));
}

function renderThreadDetail(entry: ThreadEntry): string[] {
  const lines: string[] = [];
  const color = actionStyle(entry.action);
  const bar = color("┃");

  // Header box
  const boxLines = [
    `${typeLabel(entry.type)}  ${actionIcon(entry.action)} ${actionLabel(entry.action)}`,
    chalk.dim(entry.id),
  ];
  if (entry.path) {
    const loc = entry.line ? `${entry.path}:${entry.line}` : entry.path;
    boxLines.push(chalk.underline.cyan(loc));
  }
  boxLines.push(
    entry.is_resolved
      ? chalk.green("Resolved: Yes")
      : chalk.yellow("Resolved: No"),
  );
  lines.push(drawBox(boxLines));
  lines.push("");

  // Comments
  for (const comment of entry.comments) {
    const author = comment.author
      ? chalk.bold(`@${comment.author}`)
      : chalk.dim("(unknown)");
    const date = formatDateTime(comment.created_at);

    lines.push(`  ${bar} ${author}  ${date}`);
    lines.push(`  ${bar}`);

    // Render body with indentation
    const body = renderMarkdownBody(comment.body);
    for (const bodyLine of body.split("\n")) {
      lines.push(`  ${bar}   ${bodyLine}`);
    }

    lines.push(`  ${bar}`);
    lines.push(`  ${color("┃")}`);
  }

  return lines;
}

function renderReviewDetail(entry: ReviewEntry): string[] {
  const lines: string[] = [];
  const color = actionStyle(entry.action);
  const bar = color("┃");

  // Header box
  const author = entry.author
    ? chalk.bold(`@${entry.author}`)
    : chalk.dim("(unknown)");
  const state = reviewStateStyle(entry.state);
  const boxLines = [
    `${typeLabel(entry.type)}  ${actionIcon(entry.action)} ${actionLabel(entry.action)}`,
    chalk.dim(entry.id),
    `${author}  ${state}`,
  ];
  if (entry.commit) {
    boxLines.push(chalk.dim(`commit ${entry.commit.substring(0, 12)}`));
  }
  lines.push(drawBox(boxLines));
  lines.push("");

  // Body
  if (entry.body) {
    const body = renderMarkdownBody(entry.body);
    for (const bodyLine of body.split("\n")) {
      lines.push(`  ${bar}   ${bodyLine}`);
    }
    lines.push(`  ${bar}`);
  }

  return lines;
}

function renderCommentDetail(entry: IssueCommentEntry): string[] {
  const lines: string[] = [];
  const color = actionStyle(entry.action);
  const bar = color("┃");

  // Header box
  const author = entry.author
    ? chalk.bold(`@${entry.author}`)
    : chalk.dim("(unknown)");
  const boxLines = [
    `${typeLabel(entry.type)}  ${actionIcon(entry.action)} ${actionLabel(entry.action)}`,
    chalk.dim(entry.id),
    author,
  ];
  lines.push(drawBox(boxLines));
  lines.push("");

  // Body
  if (entry.body) {
    const body = renderMarkdownBody(entry.body);
    for (const bodyLine of body.split("\n")) {
      lines.push(`  ${bar}   ${bodyLine}`);
    }
    lines.push(`  ${bar}`);
  }

  return lines;
}
