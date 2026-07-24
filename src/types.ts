// GitHub API types

export interface ReviewThread {
  id: string;
  isResolved: boolean;
  path: string | null;
  line: number | null;
  comments: ReviewThreadComment[];
}

export interface ReviewThreadComment {
  id: string;
  body: string;
  author: { login: string } | null;
  createdAt: string;
  reactions?: { nodes: Array<{ content: string }> };
  pullRequestReview?: { state: string } | null;
}

export interface Review {
  id: string;
  databaseId?: number;
  author: { login: string } | null;
  state:
    | "APPROVED"
    | "CHANGES_REQUESTED"
    | "COMMENTED"
    | "PENDING"
    | "DISMISSED";
  body: string;
  commit: { oid: string } | null;
  submittedAt: string | null;
}

export interface IssueComment {
  id: string;
  node_id: string;
  author: { login: string } | null;
  body: string;
  createdAt: string;
  reactions?: { nodes: Array<{ content: string }> };
}

export interface ReviewComment {
  id: number;
  node_id: string;
  user: { login: string } | null;
  body: string;
  path: string;
  line: number | null;
  start_line: number | null;
  commit_id: string;
  original_commit_id: string;
  pull_request_review_id: number | null;
  in_reply_to_id: number | null;
  created_at: string;
  html_url: string;
}

// Output types (JSON array entries)

export type ActionStatus = "pending" | "fix" | "skip" | "done";

export interface BaseEntry {
  id: string;
  type: string;
  action: ActionStatus;
}

export interface ThreadEntry extends BaseEntry {
  type: "thread";
  commit: string | null;
  path: string | null;
  line: number | null;
  is_resolved: boolean;
  parentReviewId?: string;
  comments: Array<{
    id: string;
    author: string | null;
    body: string;
    created_at: string;
  }>;
}

export interface ReviewEntry extends BaseEntry {
  type: "review";
  commit: string | null;
  author: string | null;
  state: string;
  body: string;
}

export interface IssueCommentEntry extends BaseEntry {
  type: "issue_comment";
  author: string | null;
  body: string;
}

export type OutputEntry = ThreadEntry | ReviewEntry | IssueCommentEntry;

// PR metadata

export interface PRMeta {
  number: number;
  title: string;
  state: string;
  headRefName: string;
  baseRefName: string;
  headRefOid: string;
}

// Config

export interface SyncConfig {
  owner: string;
  repo: string;
  prNumber: number;
}

// Fetched data container

export interface FetchedData {
  meta: PRMeta;
  threads: ReviewThread[];
  reviews: Review[];
  issueComments: IssueComment[];
  reviewComments: ReviewComment[];
}

export interface ReviewThreadsResult {
  threads: ReviewThread[];
  // totalCount reported by the GraphQL reviewThreads connection (null when unavailable)
  totalCount: number | null;
}

export type CompletenessState = "complete" | "incomplete" | "inconclusive";

// Cross-source reconciliation: REST review comments vs GraphQL threaded comments.
// Both APIs expose the same comment population under the same node ID scheme
// (PRRC_*), so any asymmetry means one transport is lagging or dropped data.
export interface ReconciliationResult {
  restReviewCommentCount: number;
  threadedReviewCommentCount: number;
  // REST comment node IDs with no matching comment in any collected thread
  missingFromThreads: string[];
  // threaded comment IDs with no matching REST review comment
  missingFromRest: string[];
  reviewThreadsTotalCount: number | null;
  collectedReviewThreads: number;
  totalCountMatches: boolean | null;
  consistent: boolean;
}

export interface ConsistencySignal {
  // false when a prerequisite source failed and reconciliation could not run
  checked: boolean;
  retries: number;
  result: ReconciliationResult | null;
}

export interface CollectionSourceSignal {
  exhausted: boolean;
  state: CompletenessState;
  warnings: string[];
  errors: string[];
}

export interface CollectionSignals {
  fallbackUsed: boolean;
  warnings: string[];
  errors: string[];
  sources: {
    reviewThreads: CollectionSourceSignal;
    issueComments: CollectionSourceSignal;
    reviewComments: CollectionSourceSignal;
  };
  consistency: ConsistencySignal;
}

export interface CollectionManifestSource {
  exhausted: boolean;
  state: CompletenessState;
  count: number;
  warnings: string[];
  errors: string[];
}

export interface CollectionManifest {
  completenessState: CompletenessState;
  fallbackUsed: boolean;
  counts: {
    issueComments: number;
    reviewsRaw: number;
    reviewThreads: number;
    // review comments as reported by the REST API
    reviewComments: number;
    // review comments actually materialized inside collected threads
    threadedReviewComments: number;
    totalEntries: number;
    pendingEntries: number;
  };
  consistency: {
    checked: boolean;
    consistent: boolean | null;
    retries: number;
    restReviewComments: number | null;
    threadedReviewComments: number | null;
    missingFromThreads: string[];
    missingFromRest: string[];
    reviewThreadsTotalCount: number | null;
    collectedReviewThreads: number | null;
    totalCountMatches: boolean | null;
  };
  sources: {
    reviewThreads: CollectionManifestSource;
    issueComments: CollectionManifestSource;
    reviewComments: CollectionManifestSource;
  };
  warnings: string[];
  errors: string[];
}
