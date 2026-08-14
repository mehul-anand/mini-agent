import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { runShellSafe } from "./shell.js";

export const getPRTool = tool(
  async (input) => {
    const num = input.number;

    const info = await runShellSafe(
      `gh pr view ${num} --json number,title,body,state,author,url,base,head --jq '. | "PR #\\(.number): \\(.title)\\nState: \\(.state)\\nAuthor: \\(.author.login)\\nBase: \\(.base.ref)\\nURL: \\(.url)\\n\\nBody:\\n\\(.body)"'`,
    );

    const diff = await runShellSafe(`gh pr diff ${num}`);

    return `${info}\n\n--- PR Diff ---\\n${diff}`;
  },
  {
    name: "getPRTool",
    description:
      "Fetches a GitHub Pull Request by number using the gh CLI. Returns the PR title, description, state, author, and the full code diff. Use this to review what changes are proposed in a PR.",
    schema: z.object({
      number: z.number().describe("The PR number to fetch (e.g. 42)."),
    }),
  },
);

export const getPRFilesTool = tool(
  async (input) => {
    const num = input.number;
    return await runShellSafe(
      `gh pr view ${num} --json files --jq '.files[] | "\\(.status): \\(.path) (+\\(.additions)/-\\(.deletions))"'`,
    );
  },
  {
    name: "getPRFilesTool",
    description:
      "Lists all files changed in a GitHub PR, with status (added/modified/deleted) and line counts. Use this to quickly see which files a PR touches.",
    schema: z.object({
      number: z.number().describe("The PR number to inspect."),
    }),
  },
);

export const commentPRTool = tool(
  async (input) => {
    const num = input.number;
    const body = input.body.replace(/"/g, '\\"');

    if (input.path && input.line) {
      // Line-specific comment via gh api
      return await runShellSafe(
        `gh api repos/$GITHUB_REPOSITORY/pulls/${num}/comments ` +
          `-f body="${body}" -f path="${input.path}" -f line=${input.line} ` +
          `-f side="RIGHT" -f start_side="RIGHT"`,
      );
    }

    return await runShellSafe(`gh pr comment ${num} --body "${body}"`);
  },
  {
    name: "commentPRTool",
    description:
      "Posts a comment on a GitHub PR. For general PR-level comments, provide number and body. For line-specific review comments, additionally provide path and line number. Uses gh CLI for authentication.",
    schema: z.object({
      number: z.number().describe("PR number."),
      body: z.string().describe("Comment text (markdown supported)."),
      path: z.string().optional().describe("File path for a line-specific comment."),
      line: z.number().optional().describe("Line number for a line-specific comment."),
    }),
  },
);

export const mergePRTool = tool(
  async (input) => {
    const num = input.number;
    const method = input.method || "squash";
    const cmd = `gh pr merge ${num} --${method}${input.deleteBranch ? " --delete-branch" : ""}`;
    return await runShellSafe(cmd);
  },
  {
    name: "mergePRTool",
    description:
      "Merges a GitHub PR. Use --method 'squash' (default) for a clean single commit, 'rebase' to rebase and merge, or 'merge' for a merge commit. Optionally delete the remote branch after merge.",
    schema: z.object({
      number: z.number().describe("PR number to merge."),
      method: z
        .enum(["squash", "rebase", "merge"])
        .optional()
        .describe("Merge method (default: squash)."),
      deleteBranch: z
        .boolean()
        .optional()
        .describe("Delete the remote branch after merging."),
    }),
  },
);
