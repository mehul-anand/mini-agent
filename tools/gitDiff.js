import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { runShellSafe } from "./shell.js";

export const gitDiffTool = tool(
  async (input) => {
    const target = input.target || "working";
    let cmd;
    switch (target) {
      case "working":
        cmd = "git diff";
        break;
      case "staged":
        cmd = "git diff --staged";
        break;
      default:
        cmd = `git diff ${target}`;
        break;
    }
    return await runShellSafe(cmd);
  },
  {
    name: "gitDiffTool",
    description:
      "Shows the git diff. By default shows unstaged changes vs. HEAD. Use target='staged' for staged changes, or pass a commit/branch name to diff against.",
    schema: z.object({
      target: z
        .enum(["working", "staged"])
        .optional()
        .describe(" 'working' for unstaged changes, 'staged' for index, or a commit ref."),
    }),
  },
);
