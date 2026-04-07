import * as fs from "node:fs";
import * as path from "node:path";
import type { OutputEntry, PRMeta, ActionStatus } from "../types.js";
import { renderList } from "./list.js";
import { renderDetail } from "./detail.js";

export interface ViewOptions {
  output: string;
  repo?: string;
  status?: string;
  type?: string;
  author?: string;
  resolved?: boolean;
  unresolved?: boolean;
}

export function viewCommand(
  owner: string,
  repo: string,
  prNumber: number,
  entryId: string | undefined,
  options: ViewOptions,
): void {
  const outputDir = path.join(
    options.output,
    owner,
    repo,
    "pr",
    prNumber.toString(),
  );

  // Check synced data exists
  const metaPath = path.join(outputDir, "pr-meta.json");
  const reviewsPath = path.join(outputDir, "reviews.json");

  if (!fs.existsSync(metaPath) || !fs.existsSync(reviewsPath)) {
    console.error(
      `No synced data found at ${outputDir}\nRun 'gh pr-review-check ${prNumber}' first to sync.`,
    );
    process.exit(1);
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as PRMeta;
  const entries = JSON.parse(
    fs.readFileSync(reviewsPath, "utf-8"),
  ) as OutputEntry[];

  // Detail view
  if (entryId) {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) {
      console.error(`Entry not found: ${entryId}`);
      process.exit(1);
    }
    renderDetail(entry, meta);
    return;
  }

  // Apply filters
  let filtered = entries;

  if (options.status) {
    const status = options.status as ActionStatus;
    filtered = filtered.filter((e) => e.action === status);
  }

  if (options.type) {
    filtered = filtered.filter((e) => e.type === options.type);
  }

  if (options.author) {
    const author = options.author;
    filtered = filtered.filter((e) => {
      if (e.type === "thread") {
        return e.comments.some((c) => c.author === author);
      }
      if (e.type === "review") {
        return e.author === author;
      }
      if (e.type === "issue_comment") {
        return e.author === author;
      }
      return false;
    });
  }

  if (options.resolved) {
    filtered = filtered.filter(
      (e) => e.type === "thread" && e.is_resolved,
    );
  }

  if (options.unresolved) {
    filtered = filtered.filter(
      (e) => e.type === "thread" && !e.is_resolved,
    );
  }

  renderList(filtered, meta);
}
