import type { ActionStatus, ReactionGroup } from "./types.js";

// GraphQL returns reaction contents as ReactionContent enum names, REST as
// reaction names. Both are compared under the REST names.
const GRAPHQL_TO_REST_CONTENT = new Map<string, string>([
  ["THUMBS_UP", "+1"],
  ["THUMBS_DOWN", "-1"],
  ["LAUGH", "laugh"],
  ["HOORAY", "hooray"],
  ["CONFUSED", "confused"],
  ["HEART", "heart"],
  ["ROCKET", "rocket"],
  ["EYES", "eyes"],
]);

export function normalizeReactionContent(content: string): string {
  return GRAPHQL_TO_REST_CONTENT.get(content) ?? content.toLowerCase();
}

// Reactions (REST names) that set each action. The order of the entries is
// the precedence when several of them are present: done, then skip, then fix.
const REACTIONS_BY_ACTION: ReadonlyArray<{
  action: ActionStatus;
  reactions: readonly string[];
}> = [
  { action: "done", reactions: ["+1", "hooray"] },
  { action: "skip", reactions: ["-1"] },
  { action: "fix", reactions: ["eyes", "rocket"] },
];

/**
 * Action set by the reactions that the authenticated account (the viewer)
 * left on a comment. Reactions left by other users are not considered.
 */
export function getActionFromViewerReactions(
  reactionGroups: ReactionGroup[] | null | undefined,
): ActionStatus | null {
  const viewerReactions = new Set(
    (reactionGroups ?? [])
      .filter((group) => group.viewerHasReacted)
      .map((group) => normalizeReactionContent(group.content)),
  );

  for (const { action, reactions } of REACTIONS_BY_ACTION) {
    if (reactions.some((reaction) => viewerReactions.has(reaction))) {
      return action;
    }
  }

  return null;
}
