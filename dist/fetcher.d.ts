import type { ReviewThread, Review, IssueComment, ReviewComment, PRMeta, SyncConfig, FetchedData } from './types.js';
export declare function fetchPRMeta(config: SyncConfig): PRMeta;
export declare function fetchReviewThreads(config: SyncConfig): ReviewThread[];
export declare function fetchReviews(config: SyncConfig): Review[];
export declare function fetchIssueComments(config: SyncConfig): IssueComment[];
export declare function fetchReviewComments(config: SyncConfig): ReviewComment[];
export declare function fetchAll(config: SyncConfig, quiet?: boolean): FetchedData;
//# sourceMappingURL=fetcher.d.ts.map