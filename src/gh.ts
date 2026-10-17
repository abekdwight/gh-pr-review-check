import { execFileSync } from "node:child_process";

const MAX_BUFFER_BYTES = 100 * 1024 * 1024;

/**
 * Run `gh` with an argument vector. The arguments reach the process as they
 * are (no shell), so query text, variables and comment bodies are never
 * interpreted by a shell.
 */
export function runGh(args: readonly string[]): string {
  try {
    return execFileSync("gh", args, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: MAX_BUFFER_BYTES,
    });
  } catch (error) {
    const err = error as { stderr?: string; message: string };
    throw new Error(`gh command failed: ${err.stderr || err.message}`);
  }
}

export type GraphQLVariables = Record<string, string | number | undefined>;

/**
 * Build the `gh api graphql` argument vector. The query and every variable
 * are one argument each. Strings go through `-f` (sent as they are); numbers
 * go through `-F`, which is not used for strings because it also interprets
 * `@file`, `true`, `false` and `null`.
 */
export function buildGraphQLArgs(
  query: string,
  variables: GraphQLVariables = {},
): string[] {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    if (value === undefined) {
      continue;
    }
    args.push(typeof value === "number" ? "-F" : "-f", `${key}=${value}`);
  }
  return args;
}

export function runGhGraphQL(
  query: string,
  variables: GraphQLVariables = {},
): string {
  return runGh(buildGraphQLArgs(query, variables));
}

/**
 * Repository of the current working directory, as resolved by `gh`.
 */
export function detectRepo(): { owner: string; repo: string } | null {
  try {
    const result = runGh([
      "repo",
      "view",
      "--json",
      "owner,name",
      "-q",
      '.owner.login+"/"+.name',
    ]).trim();
    const [owner, repo] = result.split("/");
    return { owner, repo };
  } catch {
    return null;
  }
}

/**
 * URL of the pull request for the current branch.
 */
export function currentBranchPullRequestUrl(): string {
  return runGh(["pr", "view", "--json", "url", "-q", ".url"]).trim();
}
