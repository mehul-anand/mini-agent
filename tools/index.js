// Tool registry — all tools exported here and made available to agents
// Each tool is a LangChain Tool (created with @langchain/core/tools `tool()`)

import { weatherInfo } from "./weatherInfo.js";
import { webScraper } from "./webScraper.js";
import { executeCmdTool } from "./executeCmd.js";
import { readFileTool } from "./readFile.js";
import { writeFileTool } from "./writeFile.js";
import { editFileTool } from "./editFile.js";
import { listFiles } from "./listFiles.js";
import { grepTool } from "./grep.js";
import { gitDiffTool } from "./gitDiff.js";
import { gitStatusTool, gitLogTool } from "./gitStatus.js";
import { gitCommitTool } from "./gitCommit.js";
import { getPRTool, getPRFilesTool, commentPRTool, mergePRTool } from "./github.js";

// ---- Individual tool exports ----
export {
  weatherInfo,
  webScraper,
  executeCmdTool,
  readFileTool,
  writeFileTool,
  editFileTool,
  listFiles,
  grepTool,
  gitDiffTool,
  gitStatusTool,
  gitLogTool,
  gitCommitTool,
  getPRTool,
  getPRFilesTool,
  commentPRTool,
  mergePRTool,
};

// ---- Read-only tools (safe for plan mode) ----
const readOnlyTools = [
  readFileTool, listFiles, grepTool,
  gitDiffTool, gitStatusTool, gitLogTool,
  getPRTool, getPRFilesTool,
  webScraper, weatherInfo,
  executeCmdTool,
];

// ---- Write/edit tools (build mode +) ----
const editTools = [writeFileTool, editFileTool];

// ---- Commit tool ----
const commitTools = [gitCommitTool];

// ---- GitHub write tools (auto loop only) ----
const githubWriteTools = [commentPRTool, mergePRTool];

// ---- Mode-specific tool sets ----

// Plan mode: read-only — inspect files, diffs, PRs, run read-only git/gh commands
export const PLAN_TOOLS = [...readOnlyTools];

// Build mode: read + edit + commit — can modify code and save, but not merge PRs
export const BUILD_TOOLS = [...readOnlyTools, ...editTools, ...commitTools];

// Auto loop mode: everything — full read/write/commit/merge/comment access
export const AUTO_LOOP_TOOLS = [...readOnlyTools, ...editTools, ...commitTools, ...githubWriteTools];