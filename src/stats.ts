import type {
  CollectionManifest,
  CollectionSignals,
  CompletenessState,
  FetchedData,
  OutputEntry,
} from "./types.js";

export interface PRStats {
  // Conversation breakdown
  conversation: number;
  issueComments: number;
  reviewsRaw: number;
  reviewThreads: number;

  // Thread details
  threadsResolved: number;
  threadsUnresolved: number;

  // Filtered reviews
  reviewsFiltered: number;

  // Review comments breakdown
  reviewComments: number;
  threadRoots: number;
  threadReplies: number;

  // Output entries
  totalEntries: number;
  pendingEntries: number;

  // Validation
  warnings: string[];
}

const toSourceMessages = (sourceName: string, messages: string[]): string[] => {
  return messages.map((message) => `[${sourceName}] ${message}`);
};

const uniqueMessages = (messages: string[]): string[] => {
  return Array.from(
    new Set(messages.filter((message) => message.trim().length > 0)),
  );
};

const deriveCompletenessState = (
  sources: CollectionManifest["sources"],
  warnings: string[],
  errors: string[],
): CompletenessState => {
  const sourceList = Object.values(sources);

  if (sourceList.some((source) => source.state === "inconclusive")) {
    return "inconclusive";
  }

  if (!sourceList.every((source) => source.exhausted)) {
    return "incomplete";
  }

  if (sourceList.some((source) => source.state === "incomplete")) {
    return "incomplete";
  }

  if (warnings.length > 0 || errors.length > 0) {
    return "incomplete";
  }

  return "complete";
};

export function computeStats(
  data: FetchedData,
  entries: OutputEntry[],
): PRStats {
  const warnings: string[] = [];

  // Raw counts from fetched data
  const issueComments = data.issueComments.length;
  const reviewsRaw = data.reviews.length;
  const reviewThreads = data.threads.length;

  // Conversation total
  const conversation = issueComments + reviewsRaw + reviewThreads;

  // Thread resolution status
  const threadsResolved = data.threads.filter((t) => t.isResolved).length;
  const threadsUnresolved = reviewThreads - threadsResolved;

  // Filtered reviews (exclude COMMENTED with empty body)
  const reviewsFiltered = data.reviews.filter(
    (r) => !(r.state === "COMMENTED" && !r.body?.trim()),
  ).length;

  // Review comments breakdown
  // Count total comments from threads (not from REST API which may be incomplete)
  const reviewComments = data.threads.reduce(
    (sum, t) => sum + t.comments.length,
    0,
  );
  const threadRoots = reviewThreads;
  const threadReplies = reviewComments - threadRoots;

  // Output entries stats
  const totalEntries = entries.length;
  const pendingEntries = entries.filter((e) => e.action === "pending").length;

  // Validation checks
  const expectedConversation = issueComments + reviewsRaw + reviewThreads;
  if (conversation !== expectedConversation) {
    warnings.push(
      `Conversation mismatch: ${conversation} != ${issueComments} + ${reviewsRaw} + ${reviewThreads}`,
    );
  }

  if (reviewComments < threadRoots) {
    warnings.push(
      `Review comments (${reviewComments}) less than thread roots (${threadRoots})`,
    );
  }

  return {
    conversation,
    issueComments,
    reviewsRaw,
    reviewThreads,
    threadsResolved,
    threadsUnresolved,
    reviewsFiltered,
    reviewComments,
    threadRoots,
    threadReplies,
    totalEntries,
    pendingEntries,
    warnings,
  };
}

export function formatSummary(stats: PRStats): string {
  const lines: string[] = [];

  lines.push("Summary:");
  lines.push(`Conversation: ${stats.conversation}`);
  lines.push(`  Issue Comments: ${stats.issueComments}`);
  lines.push(`  Reviews (raw): ${stats.reviewsRaw}`);
  lines.push(
    `  Review Threads: ${stats.reviewThreads} (resolved: ${stats.threadsResolved}, unresolved: ${stats.threadsUnresolved})`,
  );
  lines.push("");
  lines.push(`Reviews (filtered): ${stats.reviewsFiltered}`);
  lines.push(
    `Review Comments: ${stats.reviewComments} (thread roots: ${stats.threadRoots}, replies: ${stats.threadReplies})`,
  );
  lines.push("");
  lines.push(
    `Output Entries: ${stats.totalEntries} (pending: ${stats.pendingEntries})`,
  );

  if (stats.warnings.length > 0) {
    lines.push("");
    lines.push("WARNING: Data inconsistency detected:");
    for (const w of stats.warnings) {
      lines.push(`  - ${w}`);
    }
  }

  return lines.join("\n");
}

export function computeCollectionManifest(
  data: FetchedData,
  entries: OutputEntry[],
  stats: PRStats,
  signals: CollectionSignals,
): CollectionManifest {
  const sources: CollectionManifest["sources"] = {
    reviewThreads: {
      exhausted: signals.sources.reviewThreads.exhausted,
      state: signals.sources.reviewThreads.state,
      count: data.threads.length,
      warnings: uniqueMessages(signals.sources.reviewThreads.warnings),
      errors: uniqueMessages(signals.sources.reviewThreads.errors),
    },
    issueComments: {
      exhausted: signals.sources.issueComments.exhausted,
      state: signals.sources.issueComments.state,
      count: data.issueComments.length,
      warnings: uniqueMessages(signals.sources.issueComments.warnings),
      errors: uniqueMessages(signals.sources.issueComments.errors),
    },
    reviewComments: {
      exhausted: signals.sources.reviewComments.exhausted,
      state: signals.sources.reviewComments.state,
      count: data.reviewComments.length,
      warnings: uniqueMessages(signals.sources.reviewComments.warnings),
      errors: uniqueMessages(signals.sources.reviewComments.errors),
    },
  };

  const warnings = uniqueMessages([
    ...stats.warnings,
    ...signals.warnings,
    ...toSourceMessages("reviewThreads", sources.reviewThreads.warnings),
    ...toSourceMessages("issueComments", sources.issueComments.warnings),
    ...toSourceMessages("reviewComments", sources.reviewComments.warnings),
  ]);

  const errors = uniqueMessages([
    ...signals.errors,
    ...toSourceMessages("reviewThreads", sources.reviewThreads.errors),
    ...toSourceMessages("issueComments", sources.issueComments.errors),
    ...toSourceMessages("reviewComments", sources.reviewComments.errors),
  ]);

  return {
    completenessState: deriveCompletenessState(sources, warnings, errors),
    fallbackUsed: signals.fallbackUsed,
    counts: {
      issueComments: data.issueComments.length,
      reviewsRaw: data.reviews.length,
      reviewThreads: data.threads.length,
      reviewComments: data.reviewComments.length,
      totalEntries: entries.length,
      pendingEntries: stats.pendingEntries,
    },
    sources,
    warnings,
    errors,
  };
}
