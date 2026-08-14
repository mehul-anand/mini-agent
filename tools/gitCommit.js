import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { runShellSafe } from "./shell.js";

export const gitCommitTool = tool(
  async (input) => {
    const message = input.message.replace(/"/g, '\\"');
    const cmd = `git add -A && git commit -m "${message}" && git log --oneline -1`;
    return await runShellSafe(cmd);
  },
  {
    name: "gitCommitTool",
    description:
      "Stages all changes and creates a git commit. Use this after making code edits to save your changes. Always review your changes with gitDiffTool first.",
    schema: z.object({
      message: z.string().describe("Commit message describing the changes."),
    }),
  },
);
