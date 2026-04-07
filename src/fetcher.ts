import { execSync } from "node:child_process";
import type {
  ReviewThread,
  Review,
  IssueComment,
  ReviewComment,
  PRMeta,
  SyncConfig,
  FetchedData,
} from "./types.js";

type RestIssueCommentReactions = {
  "+1"?: number;
  "-1"?: number;
  eyes?: number;
};

type RestIssueComment = {
  node_id: string;
  user: { login: string } | null;
  body: string;
  created_at: string;
  reactions?: RestIssueCommentReactions;
};

type GraphQLErrorEntry = {
  message?: string;
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: GraphQLErrorEntry[];
};

type GraphQLPageInfo = {
  hasNextPage: boolean;
  endCursor: string | null;
};

type GraphQLThreadComment = {
  id: string;
  body: string;
  author: { login: string } | null;
  createdAt: string;
  reactions?: { nodes: Array<{ content: string }> };
};

type GraphQLThreadCommentsConnection = {
  nodes: GraphQLThreadComment[];
  pageInfo: GraphQLPageInfo;
};

type GraphQLReviewThread = {
  id: string;
  isResolved: boolean;
  path: string | null;
  line: number | null;
  comments: GraphQLThreadCommentsConnection;
};

type GraphQLReviewThreadsConnection = {
  nodes: GraphQLReviewThread[];
  pageInfo: GraphQLPageInfo;
};

type GraphQLReviewThreadsData = {
  repository?: {
    pullRequest?: {
      reviewThreads?: GraphQLReviewThreadsConnection;
    } | null;
  };
};

type GraphQLThreadCommentsData = {
  node?: {
    comments?: GraphQLThreadCommentsConnection;
  } | null;
};

type GraphQLCollectionErrorKind =
  | "GRAPHQL_PARTIAL_DATA"
  | "GRAPHQL_INVALID_SHAPE"
  | "GRAPHQL_INVALID_PAGE_INFO";

const createGraphQLCollectionError = (
  kind: GraphQLCollectionErrorKind,
  message: string,
): Error => {
  const error = new Error(`[${kind}] ${message}`);
  error.name = kind;
  return error;
};

const parseGraphQLResponse = <T>(result: string, context: string): T => {
  const parsed = JSON.parse(result) as GraphQLResponse<T>;

  if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
    const errorMessages = parsed.errors
      .map((entry) => entry.message)
      .filter((message): message is string => typeof message === "string")
      .join("; ");

    throw createGraphQLCollectionError(
      "GRAPHQL_PARTIAL_DATA",
      `${context} returned errors: ${errorMessages || "unknown GraphQL error"}`,
    );
  }

  if (!parsed.data) {
    throw createGraphQLCollectionError(
      "GRAPHQL_INVALID_SHAPE",
      `${context} response did not include data`,
    );
  }

  return parsed.data;
};

const requirePageInfo = (
  pageInfo: GraphQLPageInfo | null | undefined,
  context: string,
): GraphQLPageInfo => {
  if (!pageInfo || typeof pageInfo.hasNextPage !== "boolean") {
    throw createGraphQLCollectionError(
      "GRAPHQL_INVALID_SHAPE",
      `${context} response did not include a valid pageInfo`,
    );
  }

  return pageInfo;
};

const getNextCursorOrNull = (
  pageInfo: GraphQLPageInfo,
  context: string,
): string | null => {
  if (!pageInfo.hasNextPage) {
    return null;
  }

  if (
    typeof pageInfo.endCursor !== "string" ||
    pageInfo.endCursor.trim() === ""
  ) {
    throw createGraphQLCollectionError(
      "GRAPHQL_INVALID_PAGE_INFO",
      `${context} returned hasNextPage=true without a usable endCursor`,
    );
  }

  return pageInfo.endCursor;
};

function runGh(args: string): string {
  try {
    return execSync(`gh ${args}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 100 * 1024 * 1024,
    });
  } catch (error) {
    const err = error as { stderr?: string; message: string };
    throw new Error(`gh command failed: ${err.stderr || err.message}`);
  }
}

function runGhApiGraphQL(
  query: string,
  variables: Record<string, string | number | undefined>,
): string {
  const varArgs = Object.entries(variables)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      if (typeof value === "number") {
        return `-F ${key}=${value}`;
      }
      return `-f ${key}=${value}`;
    })
    .join(" ");
  return runGh(
    `api graphql -f query='${query}'${varArgs ? ` ${varArgs}` : ""}`,
  );
}

function fetchPaginatedRestCollection<T>(endpoint: string): T[] {
  const json = runGh(`api --paginate --slurp ${endpoint}`);
  const parsed = JSON.parse(json) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error(`Unexpected paginated REST response shape for ${endpoint}`);
  }

  return parsed.flatMap((page) => (Array.isArray(page) ? page : [page])) as T[];
}

export function fetchPRMeta(config: SyncConfig): PRMeta {
  const json = runGh(
    `pr view ${config.prNumber} --repo ${config.owner}/${config.repo} --json number,title,state,headRefName,baseRefName,headRefOid`,
  );
  return JSON.parse(json);
}

export function fetchReviewThreads(config: SyncConfig): ReviewThread[] {
  const reviewThreadsQuery = `
    query($owner: String!, $repo: String!, $number: Int!, $threadsAfter: String) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          reviewThreads(first: 100, after: $threadsAfter) {
            nodes {
              id
              isResolved
              path
              line
              comments(first: 100) {
                nodes {
                  id
                  body
                  author { login }
                  createdAt
                  reactions(first: 20) {
                    nodes {
                      content
                    }
                  }
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    }
  `;

  const threadCommentsQuery = `
    query($threadId: ID!, $commentsAfter: String) {
      node(id: $threadId) {
        ... on PullRequestReviewThread {
          comments(first: 100, after: $commentsAfter) {
            nodes {
              id
              body
              author { login }
              createdAt
              reactions(first: 20) {
                nodes {
                  content
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    }
  `;

  const allThreads: ReviewThread[] = [];
  let threadsAfter: string | undefined;

  while (true) {
    const result = runGhApiGraphQL(reviewThreadsQuery, {
      owner: config.owner,
      repo: config.repo,
      number: config.prNumber,
      threadsAfter,
    });

    const data = parseGraphQLResponse<GraphQLReviewThreadsData>(
      result,
      "reviewThreads",
    );
    const reviewThreadsConnection = data.repository?.pullRequest?.reviewThreads;

    if (
      !reviewThreadsConnection ||
      !Array.isArray(reviewThreadsConnection.nodes)
    ) {
      throw createGraphQLCollectionError(
        "GRAPHQL_INVALID_SHAPE",
        "reviewThreads response did not include nodes",
      );
    }

    for (const thread of reviewThreadsConnection.nodes) {
      if (!thread.comments || !Array.isArray(thread.comments.nodes)) {
        throw createGraphQLCollectionError(
          "GRAPHQL_INVALID_SHAPE",
          `review thread ${thread.id} did not include comment nodes`,
        );
      }

      const threadComments = [...thread.comments.nodes];
      let commentsAfter = getNextCursorOrNull(
        requirePageInfo(
          thread.comments.pageInfo,
          `thread ${thread.id} comments`,
        ),
        `thread ${thread.id} comments`,
      );

      while (commentsAfter !== null) {
        const commentsResult = runGhApiGraphQL(threadCommentsQuery, {
          threadId: thread.id,
          commentsAfter,
        });

        const commentsData = parseGraphQLResponse<GraphQLThreadCommentsData>(
          commentsResult,
          `thread ${thread.id} comments`,
        );
        const commentsConnection = commentsData.node?.comments;

        if (!commentsConnection || !Array.isArray(commentsConnection.nodes)) {
          throw createGraphQLCollectionError(
            "GRAPHQL_INVALID_SHAPE",
            `thread ${thread.id} comments page did not include nodes`,
          );
        }

        threadComments.push(...commentsConnection.nodes);
        commentsAfter = getNextCursorOrNull(
          requirePageInfo(
            commentsConnection.pageInfo,
            `thread ${thread.id} comments`,
          ),
          `thread ${thread.id} comments`,
        );
      }

      allThreads.push({
        id: thread.id,
        isResolved: thread.isResolved,
        path: thread.path,
        line: thread.line,
        comments: threadComments,
      });
    }

    const nextThreadsCursor = getNextCursorOrNull(
      requirePageInfo(reviewThreadsConnection.pageInfo, "reviewThreads"),
      "reviewThreads",
    );

    if (nextThreadsCursor === null) {
      break;
    }

    threadsAfter = nextThreadsCursor;
  }

  return allThreads;
}

type RestReview = {
  id: number;
  node_id: string;
  user: { login: string } | null;
  body: string | null;
  state: string;
  commit_id: string | null;
  submitted_at: string | null;
};

export function fetchReviews(config: SyncConfig): Review[] {
  const reviews = fetchPaginatedRestCollection<RestReview>(
    `repos/${config.owner}/${config.repo}/pulls/${config.prNumber}/reviews`,
  );
  return reviews.map((r) => ({
    id: r.node_id,
    databaseId: r.id,
    author: r.user ? { login: r.user.login } : null,
    state: r.state as Review["state"],
    body: r.body || "",
    commit: r.commit_id ? { oid: r.commit_id } : null,
    submittedAt: r.submitted_at,
  }));
}

export function fetchIssueComments(config: SyncConfig): IssueComment[] {
  const comments = fetchPaginatedRestCollection<RestIssueComment>(
    `repos/${config.owner}/${config.repo}/issues/${config.prNumber}/comments`,
  );

  return comments.map((comment) => {
    const reactions = comment.reactions ?? {};

    return {
      id: comment.node_id,
      node_id: comment.node_id,
      author: comment.user ? { login: comment.user.login } : null,
      body: comment.body,
      createdAt: comment.created_at,
      reactions: {
        nodes: [
          ...((reactions["+1"] ?? 0) > 0 ? [{ content: "+1" }] : []),
          ...((reactions["-1"] ?? 0) > 0 ? [{ content: "-1" }] : []),
          ...((reactions.eyes ?? 0) > 0 ? [{ content: "eyes" }] : []),
        ],
      },
    };
  });
}

export function fetchReviewComments(config: SyncConfig): ReviewComment[] {
  return fetchPaginatedRestCollection<ReviewComment>(
    `repos/${config.owner}/${config.repo}/pulls/${config.prNumber}/comments`,
  );
}

export function fetchAll(
  config: SyncConfig,
  quiet: boolean = false,
): FetchedData {
  const log = quiet ? () => {} : console.error;

  log("Fetching PR metadata...");
  const meta = fetchPRMeta(config);

  log("Fetching review threads...");
  const threads = fetchReviewThreads(config);

  log("Fetching reviews...");
  const reviews = fetchReviews(config);

  log("Fetching issue comments...");
  const issueComments = fetchIssueComments(config);

  log("Fetching review comments...");
  const reviewComments = fetchReviewComments(config);

  return { meta, threads, reviews, issueComments, reviewComments };
}
