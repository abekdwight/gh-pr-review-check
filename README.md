# gh-pr-review-check

GitHub CLI extension to sync PR review data for AI-assisted review handling.

## Installation

```bash
gh extension install abekdwight/gh-pr-review-check
```

This extension ships with a committed `dist/index.cjs` bundle so `gh extension install` and `gh extension upgrade` do not rely on a post-install build step.

## Usage

```bash
# Sync PR reviews (auto-detect repo from current directory)
gh pr-review-check 728

# Sync with explicit repo
gh pr-review-check 728 -R owner/repo

# Or with full URL
gh pr-review-check https://github.com/owner/repo/pull/728

# Custom output directory
gh pr-review-check 728 -o /path/to/output

# JSON output (useful for scripting)
gh pr-review-check 728 --json

# Quiet mode (suppress progress messages)
gh pr-review-check 728 --quiet
```

## Options

- `-R, --repo <repo>` - Repository in OWNER/REPO format (auto-detected from cwd)
- `-o, --output <dir>` - Output directory (default: `/tmp/github.com`)
- `-j, --json` - Output as JSON with outputDir, stats, completenessState, and manifest data
- `-q, --quiet` - Suppress progress messages

## Output

The command creates three output files (the artifact trio):

```
/tmp/github.com/owner/repo/pr/728/
├── pr-meta.json             # PR metadata (title, branches, state)
├── reviews.json             # Review entries (JSON array)
└── collection-manifest.json # Completeness state and source signals
```

### Artifact Trio

| File                       | Purpose                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pr-meta.json`             | PR metadata: title, base/head branches, author, state                                                                                             |
| `reviews.json`             | Review entries (threads, reviews, issue comments). **Only authoritative when `collection-manifest.json` reports `completenessState: "complete"`** |
| `collection-manifest.json` | Completeness state, source exhaustion flags, warnings, and errors                                                                                 |

### collection-manifest.json Structure

```json
{
  "completenessState": "complete" | "incomplete" | "inconclusive",
  "fallbackUsed": false,
  "counts": { ... },
  "sources": {
    "reviewThreads": { "exhausted": true, "state": "complete", "warnings": [], "errors": [] },
    "issueComments": { "exhausted": true, "state": "complete", "warnings": [], "errors": [] },
    "reviewComments": { "exhausted": true, "state": "complete", "warnings": [], "errors": [] }
  },
  "warnings": [],
  "errors": []
}
```

**Important**: Always check `completenessState` before treating `reviews.json` as a complete dataset. When `completenessState` is not `"complete"`, the data may be partial due to API errors, pagination failures, or source inconsistencies.

### reviews.json Format

A JSON array of review entry objects:

**Thread (inline review comments):**

```json
{"id":"PRRT_xxx","type":"thread","commit":"abc123","path":"src/app.ts","line":42,"is_resolved":false,"action":"pending","comments":[...]}
```

**Review (APPROVED, CHANGES_REQUESTED, etc.):**

```json
{
  "id": "PRR_xxx",
  "type": "review",
  "commit": "abc123",
  "author": "copilot",
  "state": "APPROVED",
  "body": "",
  "action": "pending"
}
```

**Issue Comment (PR-level comments):**

```json
{
  "id": "IC_xxx",
  "type": "issue_comment",
  "author": "coderabbitai",
  "body": "Summary...",
  "action": "pending"
}
```

### Action Status

- `pending` - Not yet processed
- `fix` - Will be fixed
- `skip` - Will be skipped
- `done` - Completed (automatically set for resolved threads)

## Development

```bash
# Clone
ghq get git@github.com:abekdwight/gh-pr-review-check.git

# Install dependencies
npm install

# Build
npm run build

# Commit the rebuilt dist artifact when source changes
git add dist/index.cjs

# Test locally
node dist/index.cjs 728 -R owner/repo
```

### Test Fixtures

Large test snapshots live under `src/test-fixtures/<module>/`.
Keep fixture data next to the module's tests conceptually, while making it obvious that the assets are test-only.

## License

MIT
