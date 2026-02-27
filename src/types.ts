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
}

export interface Review {
  id: string;
  author: { login: string } | null;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING' | 'DISMISSED';
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

// Output types (JSONL entries)

export type ActionStatus = 'pending' | 'fix' | 'skip' | 'done';

export interface BaseEntry {
  id: string;
  type: string;
  action: ActionStatus;
}

export interface ThreadEntry extends BaseEntry {
  type: 'thread';
  commit: string | null;
  path: string | null;
  line: number | null;
  is_resolved: boolean;
  comments: Array<{
    id: string;
    author: string | null;
    body: string;
    created_at: string;
  }>;
}

export interface ReviewEntry extends BaseEntry {
  type: 'review';
  commit: string | null;
  author: string | null;
  state: string;
  body: string;
}

export interface IssueCommentEntry extends BaseEntry {
  type: 'issue_comment';
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
