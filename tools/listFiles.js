import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { statSync, readdirSync, existsSync } from "fs";
import { dirname } from "path";

export const listFiles = tool(
  async (input) => {
    const dir = input.path || ".";

    if (!existsSync(dir)) {
      return `Directory does not exist: ${dir}`;
    }

    const stat = statSync(dir);
    if (!stat.isDirectory()) {
      return `Not a directory: ${dir}`;
    }

    const entries = readdirSync(dir, { withFileTypes: true });
    const items = entries.map((e) => {
      const suffix = e.isDirectory() ? "/" : "";
      const prefix = e.isDirectory() ? "📁 " : "📄 ";
      return `${prefix}${e.name}${suffix}`;
    });

    return items.length
      ? `Contents of ${dir}:\n` + items.join("\n")
      : `Directory is empty: ${dir}`;
  },
  {
    name: "listFiles",
    description:
      "Lists the contents of a directory. Returns file names (with 📄) and subdirectory names (with 📁). Use this to explore a project's structure.",
    schema: z.object({
      path: z.string().optional().describe("Directory path to list. Defaults to current directory."),
    }),
  },
);
