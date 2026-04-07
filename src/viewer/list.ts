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

/**
 * A review with its associated child threads grouped together.
 */
interface ReviewCluster {
  review: ReviewEntry;
  children: ThreadEntry[];
}

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

  // ── Status summary (flat count of all entries) ──
  const counts = new Map<ActionStatus, number>();
  for (const a of ACTION_ORDER) counts.set(a, 0);
  for (const e of entries)
    counts.set(e.action, (counts.get(e.action) ?? 0) + 1);

  const summary = ACTION_ORDER.map((a) => {
    const icon = actionIcon(a);
    const label = actionLabel(a);
    const count = chalk.bold(String(counts.get(a)));
    return `${icon} ${label} ${count}`;
  }).join("    ");
  lines.push(`  ${summary}`);
  lines.push("");

  // ── Build parent-child relationships ──
  const childThreadIds = new Set<string>();
  const childrenByReview = new Map<string, ThreadEntry[]>();

  for (const entry of entries) {
    if (entry.type === "thread" && entry.parentReviewId) {
      childThreadIds.add(entry.id);
      const children = childrenByReview.get(entry.parentReviewId) ?? [];
      children.push(entry);
      childrenByReview.set(entry.parentReviewId, children);
    }
  }

  // Top-level entries = reviews + orphan threads + issue comments
  const topLevel = entries.filter(
    (e) => !childThreadIds.has(e.id),
  );

  // ── Render grouped by action ──
  for (const action of ACTION_ORDER) {
    const group = topLevel.filter((e) => e.action === action);
    if (group.length === 0) continue;

    // Count includes children
    let totalInGroup = 0;
    for (const entry of group) {
      totalInGroup += 1;
      if (entry.type === "review") {
        totalInGroup += (childrenByReview.get(entry.id) ?? []).length;
      }
    }

    lines.push(
      sectionHeader(
        action.charAt(0).toUpperCase() + action.slice(1),
        totalInGroup,
      ),
    );
    lines.push("");

    for (const entry of group) {
      lines.push(...renderEntryCard(entry));

      // Render child threads indented under review
      if (entry.type === "review") {
        const children = childrenByReview.get(entry.id) ?? [];
        if (children.length > 0) {
          const reviewBar = actionStyle(entry.action)("┃");
          lines.push(`  ${reviewBar}`);
          for (const child of children) {
            lines.push(...renderThreadCardNested(child, entry.action));
            lines.push(`  ${reviewBar}`);
          }
        }
      }

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
  return renderThreadCardInner(entry, "  ");
}

/**
 * Render a thread card nested under a review, with the review's bar as prefix.
 */
function renderThreadCardNested(
  entry: ThreadEntry,
  parentAction: ActionStatus,
): string[] {
  const reviewBar = actionStyle(parentAction)("┃");
  const prefix = `  ${reviewBar}   `;
  return renderThreadCardInner(entry, prefix);
}

function renderThreadCardInner(entry: ThreadEntry, prefix: string): string[] {
  const lines: string[] = [];
  const color = actionStyle(entry.action);
  const bar = color("┃");

  // Header line
  const header = `${prefix}${typeLabel(entry.type)}  ${actionIcon(entry.action)} ${actionLabel(entry.action)}`;
  const id = chalk.dim(entry.id);
  lines.push(`${header}  ${id}`);

  // File path
  if (entry.path) {
    const loc = entry.line ? `${entry.path}:${entry.line}` : entry.path;
    lines.push(`${prefix}${bar} ${chalk.underline.cyan(loc)}`);
  }

  // Author & date
  const firstComment = entry.comments[0];
  if (firstComment) {
    const author = firstComment.author
      ? chalk.bold(`@${firstComment.author}`)
      : chalk.dim("(unknown)");
    const date = formatDate(firstComment.created_at);
    const resolved = entry.is_resolved ? chalk.green(" ✔ resolved") : "";
    lines.push(`${prefix}${bar} ${author}  ${date}${resolved}`);
  }

  // Body summary
  if (firstComment) {
    const summaryText = extractSummary(firstComment.body);
    if (summaryText) {
      lines.push(`${prefix}${bar} ${summaryText}`);
    }
  }

  return lines;
}

function renderReviewCard(entry: ReviewEntry): string[] {
  const lines: string[] = [];
  const color = actionStyle(entry.action);
  const bar = color("┃");

  const header = `  ${typeLabel(entry.type)}  ${actionIcon(entry.action)} ${actionLabel(entry.action)}`;
  const id = chalk.dim(entry.id);
  lines.push(`${header}  ${id}`);

  const author = entry.author
    ? chalk.bold(`@${entry.author}`)
    : chalk.dim("(unknown)");
  const state = reviewStateStyle(entry.state);
  lines.push(`  ${bar} ${author}  ${state}`);

  if (entry.body) {
    const summaryText = extractSummary(entry.body);
    if (summaryText) {
      lines.push(`  ${bar} ${summaryText}`);
    }
  }

  return lines;
}

function renderCommentCard(entry: IssueCommentEntry): string[] {
  const lines: string[] = [];
  const color = actionStyle(entry.action);
  const bar = color("┃");

  const header = `  ${typeLabel(entry.type)}  ${actionIcon(entry.action)} ${actionLabel(entry.action)}`;
  const id = chalk.dim(entry.id);
  lines.push(`${header}  ${id}`);

  const author = entry.author
    ? chalk.bold(`@${entry.author}`)
    : chalk.dim("(unknown)");
  lines.push(`  ${bar} ${author}`);

  if (entry.body) {
    const summaryText = extractSummary(entry.body);
    if (summaryText) {
      lines.push(`  ${bar} ${summaryText}`);
    }
  }

  return lines;
}
