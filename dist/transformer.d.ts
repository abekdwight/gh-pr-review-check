import type { FetchedData, OutputEntry } from './types.js';
/**
 * Transform fetched data to output entries
 */
export declare function transform(data: FetchedData): OutputEntry[];
/**
 * Format entries as JSONL
 */
export declare function toJsonl(entries: OutputEntry[]): string;
//# sourceMappingURL=transformer.d.ts.map