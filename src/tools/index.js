import listFiles from "./listFiles.js";
import readFile from "./readFile.js";
import grep from "./grep.js";
import gitStatus from "./gitStatus.js";
import gitDiff from "./gitDiff.js";
import writeFile from "./writeFile.js";
import editFile from "./editFile.js";

/**
 * Tool registry + adapter.
 * Each tool lives in its own file (default export = tool definition) and is
 * aggregated here. `MODE_TOOLS` mirrors v2's PLAN/BUILD/AUTO grouping.
 */

export const TOOLS = [
  listFiles,
  readFile,
  grep,
  gitStatus,
  gitDiff,
  writeFile,
  editFile,
];

/**
 * Mode → tool name whitelist (defense-in-depth on top of runtime checks).
 * PLAN ships read-only. More modes/tools land in later phases.
 */
export const MODE_TOOLS = {
  PLAN: ["list_files", "read_file", "grep", "git_status", "git_diff"],
  BUILD: [
    "list_files",
    "read_file",
    "grep",
    "git_status",
    "git_diff",
    "write_file",
    "edit_file",
  ],
  AUTO: ["list_files", "read_file", "grep", "git_status", "git_diff"],
};

const registry = new Map(TOOLS.map((t) => [t.name, t]));

/** Tools offered to the model for a given mode. */
export function toolsForMode(mode) {
  const names = MODE_TOOLS[mode] || MODE_TOOLS.PLAN;
  return TOOLS.filter((t) => names.includes(t.name));
}

/** Project a tool definition into an OpenAI `function` tool schema. */
export function toOpenAISchema(tool) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

/** Execute a model tool call. `call` is an OpenAI tool_call object. */
export async function executeToolCall(call) {
  const tool = registry.get(call.function.name);
  if (!tool) throw new Error(`Unknown tool: ${call.function.name}`);
  const args = JSON.parse(call.function.arguments || "{}");
  const result = await tool.run(args);
  return String(result);
}
