# gh-pr-review-check

GitHub CLI extension to sync PR review data for AI-assisted review handling.

## Installation

```bash
gh extension install abekdwight/gh-pr-review-check
```

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
- `-j, --json` - Output as JSON (only the output directory path)
- `-q, --quiet` - Suppress progress messages

## Output

The command creates a directory structure:

```
/tmp/github.com/owner/repo/pr/728/
├── pr-meta.json      # PR metadata (title, branches, state)
└── reviews.jsonl     # All review entries (one JSON per line)
```

### reviews.jsonl Format

Each line is a JSON object representing a review entry:

**Thread (inline review comments):**
```json
{"id":"PRRT_xxx","type":"thread","commit":"abc123","path":"src/app.ts","line":42,"is_resolved":false,"action":"pending","comments":[...]}
```

**Review (APPROVED, CHANGES_REQUESTED, etc.):**
```json
{"id":"PRR_xxx","type":"review","commit":"abc123","author":"copilot","state":"APPROVED","body":"","action":"pending"}
```

**Issue Comment (PR-level comments):**
```json
{"id":"IC_xxx","type":"issue_comment","author":"coderabbitai","body":"Summary...","action":"pending"}
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

# Test locally
node dist/index.js 728 -R owner/repo
```

## License

MIT
