#!/usr/bin/env node

import { Command } from "commander";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { parsePRUrl } from "./utils.js";
import {
  fetchIssueComments,
  fetchPRMeta,
  fetchReviewComments,
  fetchReviews,
  fetchReviewThreads,
} from "./fetcher.js";
import { transform, toJson } from "./transformer.js";
import {
  computeCollectionManifest,
  computeStats,
  formatSummary,
} from "./stats.js";
import { resolve, Status } from "./resolve.js";
import { viewCommand } from "./viewer/index.js";
import type {
  CollectionSignals,
  CompletenessState,
  FetchedData,
  SyncConfig,
} from "./types.js";

type TrackedSourceName = keyof CollectionSignals["sources"];

const GRAPHQL_INCONCLUSIVE_ERROR_NAMES = new Set([
  "GRAPHQL_PARTIAL_DATA",
  "GRAPHQL_INVALID_PAGE_INFO",
]);

const createInitialCollectionSignals = (): CollectionSignals => ({
  fallbackUsed: false,
  warnings: [],
  errors: [],
  sources: {
    reviewThreads: {
      exhausted: false,
      state: "incomplete",
      warnings: [],
      errors: [],
    },
    issueComments: {
      exhausted: false,
      state: "incomplete",
      warnings: [],
      errors: [],
    },
    reviewComments: {
      exhausted: false,
      state: "incomplete",
      warnings: [],
      errors: [],
    },
  },
});

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

const toErrorName = (error: unknown): string => {
  if (error instanceof Error && typeof error.name === "string") {
    return error.name;
  }

  return "";
};

const classifyTrackedSourceState = (error: unknown): CompletenessState => {
  const errorName = toErrorName(error);
  const errorMessage = toErrorMessage(error);

  if (GRAPHQL_INCONCLUSIVE_ERROR_NAMES.has(errorName)) {
    return "inconclusive";
  }

  if (
    errorMessage.includes("GRAPHQL_PARTIAL_DATA") ||
    errorMessage.includes("GRAPHQL_INVALID_PAGE_INFO")
  ) {
    return "inconclusive";
  }

  return "incomplete";
};

const markTrackedSourceSuccess = (
  signals: CollectionSignals,
  sourceName: TrackedSourceName,
): void => {
  signals.sources[sourceName] = {
    exhausted: true,
    state: "complete",
    warnings: [],
    errors: [],
  };
};

const markTrackedSourceFailure = (
  signals: CollectionSignals,
  sourceName: TrackedSourceName,
  error: unknown,
): void => {
  const state = classifyTrackedSourceState(error);
  const message = toErrorMessage(error);

  signals.sources[sourceName] = {
    exhausted: false,
    state,
    warnings: [],
    errors: [message],
  };
};

const collectDataWithSignals = (
  config: SyncConfig,
  quiet: boolean,
): {
  data: FetchedData;
  signals: CollectionSignals;
} => {
  const log = quiet ? () => {} : console.error;
  const signals = createInitialCollectionSignals();

  log("Fetching PR metadata...");
  const meta = fetchPRMeta(config);

  let threads = [] as FetchedData["threads"];
  log("Fetching review threads...");
  try {
    threads = fetchReviewThreads(config);
    markTrackedSourceSuccess(signals, "reviewThreads");
  } catch (error) {
    markTrackedSourceFailure(signals, "reviewThreads", error);
  }

  let reviews = [] as FetchedData["reviews"];
  log("Fetching reviews...");
  try {
    reviews = fetchReviews(config);
  } catch (error) {
    const message = toErrorMessage(error);
    signals.errors.push(`[reviews] ${message}`);
    signals.warnings.push(
      "reviews source failed; completeness downgraded to incomplete",
    );
  }

  let issueComments = [] as FetchedData["issueComments"];
  log("Fetching issue comments...");
  try {
    issueComments = fetchIssueComments(config);
    markTrackedSourceSuccess(signals, "issueComments");
  } catch (error) {
    markTrackedSourceFailure(signals, "issueComments", error);
  }

  let reviewComments = [] as FetchedData["reviewComments"];
  log("Fetching review comments...");
  try {
    reviewComments = fetchReviewComments(config);
    markTrackedSourceSuccess(signals, "reviewComments");
  } catch (error) {
    markTrackedSourceFailure(signals, "reviewComments", error);
  }

  return {
    data: {
      meta,
      threads,
      reviews,
      issueComments,
      reviewComments,
    },
    signals,
  };
};

function detectRepo(): { owner: string; repo: string } | null {
  try {
    const result = execSync(
      'gh repo view --json owner,name -q ".owner.login+\\"/\\"+.name"',
      {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    ).trim();
    const [owner, repo] = result.split("/");
    return { owner, repo };
  } catch {
    return null;
  }
}

function resolvePRIdentifier(
  pr: string | undefined,
  repoOption?: string,
): { owner: string; repo: string; prNumber: number } {
  if (pr) {
    if (pr.startsWith("http") || pr.includes("github.com")) {
      return parsePRUrl(pr);
    }
    if (pr.includes("/")) {
      const match = pr.match(/^([^/]+)\/([^/#]+)[#/]?(\d+)$/);
      if (!match) {
        throw new Error(`Invalid PR format: ${pr}`);
      }
      return { owner: match[1], repo: match[2], prNumber: parseInt(match[3], 10) };
    }
    // Just a number
    let owner: string;
    let repo: string;
    if (repoOption) {
      [owner, repo] = repoOption.split("/");
    } else {
      const detected = detectRepo();
      if (!detected) {
        throw new Error("--repo is required when PR is just a number and no git repo detected");
      }
      owner = detected.owner;
      repo = detected.repo;
    }
    return { owner, repo, prNumber: parseInt(pr, 10) };
  }
  // Auto-detect from current branch
  const prUrl = execSync("gh pr view --json url -q .url", {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  return parsePRUrl(prUrl);
}

const program = new Command();

program
  .name("gh-pr-review-check")
  .description("Sync PR review data for AI-assisted review handling")
  .version("0.0.4")
  .enablePositionalOptions();

// Default command: sync
program
  .argument("[pr]", "PR number or URL (defaults to current branch)")
  .option("-o, --output <dir>", "Output directory", "/tmp/github.com")
  .option(
    "-R, --repo <repo>",
    "Repository in OWNER/REPO format (auto-detected from cwd)",
  )
  .option(
    "-j, --json",
    "Output as JSON with outputDir, stats, completenessState, and manifest data",
  )
  .option("-q, --quiet", "Suppress progress messages")
  .action(
    async (
      pr: string | undefined,
      options: {
        output: string;
        repo?: string;
        json?: boolean;
        quiet?: boolean;
      },
    ) => {
      try {
        await syncCommand(pr, options);
      } catch (error) {
        const err = error as Error;
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    },
  );

// Resolve command
program
  .command("resolve <entry-id>")
  .description(
    "Mark an entry as done, skip, or in_progress by adding a reaction",
  )
  .requiredOption(
    "-s, --status <status>",
    "Status to set (done, skip, in_progress)",
  )
  .option("-c, --comment <text>", "Add a comment with the status change")
  .option(
    "-R, --repo <repo>",
    "Repository in OWNER/REPO format (auto-detected from cwd)",
  )
  .action(
    (
      entryId: string,
      options: { status: string; comment?: string; repo?: string },
    ) => {
      try {
        const status = options.status as Status;
        if (!["done", "skip", "in_progress"].includes(status)) {
          throw new Error(
            `Invalid status: ${status}. Must be one of: done, skip, in_progress`,
          );
        }

        let owner: string;
        let repo: string;

        if (options.repo) {
          const [o, r] = options.repo.split("/");
          owner = o;
          repo = r;
        } else {
          const detected = detectRepo();
          if (!detected) {
            throw new Error("--repo is required when no git repo detected");
          }
          owner = detected.owner;
          repo = detected.repo;
        }

        resolve({
          owner,
          repo,
          entryId,
          status,
          comment: options.comment,
        });
      } catch (error) {
        const err = error as Error;
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    },
  );

// View command
program
  .command("view [pr] [entry-id]")
  .description("Display synced PR review data in a human-readable format")
  .option("-o, --output <dir>", "Output directory", "/tmp/github.com")
  .option(
    "-R, --repo <repo>",
    "Repository in OWNER/REPO format (auto-detected from cwd)",
  )
  .option("-s, --status <status>", "Filter by action status (pending, fix, skip, done)")
  .option("-t, --type <type>", "Filter by entry type (thread, review, issue_comment)")
  .option("-a, --author <login>", "Filter by author login")
  .option("--resolved", "Show only resolved threads")
  .option("--unresolved", "Show only unresolved threads")
  .action(
    (
      pr: string | undefined,
      entryId: string | undefined,
      options: {
        output: string;
        repo?: string;
        status?: string;
        type?: string;
        author?: string;
        resolved?: boolean;
        unresolved?: boolean;
      },
    ) => {
      try {
        const { owner, repo, prNumber } = resolvePRIdentifier(pr, options.repo);
        // Always sync before rendering to ensure fresh data
        syncCore(owner, repo, prNumber, options.output, true);
        viewCommand(owner, repo, prNumber, entryId, options);
      } catch (error) {
        const err = error as Error;
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    },
  );

interface SyncResult {
  outputDir: string;
  data: FetchedData;
  entries: ReturnType<typeof transform>;
  stats: ReturnType<typeof computeStats>;
  manifest: ReturnType<typeof computeCollectionManifest>;
  signals: CollectionSignals;
}

function syncCore(
  owner: string,
  repo: string,
  prNumber: number,
  outputBase: string,
  quiet: boolean,
): SyncResult {
  const log = quiet ? () => {} : console.error;

  log(`Syncing PR #${prNumber} from ${owner}/${repo}...`);

  const outputDir = path.join(outputBase, owner, repo, "pr", prNumber.toString());
  fs.mkdirSync(outputDir, { recursive: true });

  const { data, signals } = collectDataWithSignals({ owner, repo, prNumber }, quiet);

  const metaPath = path.join(outputDir, "pr-meta.json");
  fs.writeFileSync(metaPath, JSON.stringify(data.meta, null, 2));
  log(`Wrote ${metaPath}`);

  const entries = transform(data);
  const reviewsPath = path.join(outputDir, "reviews.json");
  fs.writeFileSync(reviewsPath, toJson(entries));
  log(`Wrote ${reviewsPath} (${entries.length} entries)`);

  const stats = computeStats(data, entries);
  const manifest = computeCollectionManifest(data, entries, stats, signals);
  const manifestPath = path.join(outputDir, "collection-manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  log(`Wrote ${manifestPath}`);

  return { outputDir, data, entries, stats, manifest, signals };
}

async function syncCommand(
  pr: string | undefined,
  options: { output: string; repo?: string; json?: boolean; quiet?: boolean },
): Promise<void> {
  const { owner, repo, prNumber } = resolvePRIdentifier(pr, options.repo);
  const { outputDir, stats, manifest } = syncCore(
    owner,
    repo,
    prNumber,
    options.output,
    options.quiet ?? false,
  );

  if (!options.quiet) {
    console.error("");
    console.error(formatSummary(stats));
    console.error(`Completeness: ${manifest.completenessState}`);
    console.error("");
  }

  if (options.json) {
    console.log(
      JSON.stringify({
        outputDir,
        prNumber,
        owner,
        repo,
        conversation: stats.conversation,
        issueComments: stats.issueComments,
        reviewsRaw: stats.reviewsRaw,
        reviewThreads: stats.reviewThreads,
        threadsResolved: stats.threadsResolved,
        threadsUnresolved: stats.threadsUnresolved,
        reviewsFiltered: stats.reviewsFiltered,
        reviewComments: stats.reviewComments,
        threadRoots: stats.threadRoots,
        threadReplies: stats.threadReplies,
        totalEntries: stats.totalEntries,
        pendingEntries: stats.pendingEntries,
        warnings: stats.warnings,
        completenessState: manifest.completenessState,
        fallbackUsed: manifest.fallbackUsed,
        manifestWarnings: manifest.warnings,
        manifestErrors: manifest.errors,
      }),
    );
  } else {
    console.log(outputDir);
  }
}

program.parse();
