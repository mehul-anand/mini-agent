import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

import { CONFIG } from "./config.js";
import { PLAN_PROMPT, BUILD_PROMPT, EVAL_PROMPT, CRITIQUE_PROMPT } from "./prompts/index.js";
import { PLAN_TOOLS, BUILD_TOOLS } from "./tools/index.js";

import { createAutoLoopAgent as createAutoLoopAgentInternal } from "./graphs/autoLoop.js";

function createLLM(opts = {}) {
  return new ChatOpenAI({
    model: opts.model || CONFIG.model,
    apiKey: CONFIG.openaiApiKey,
    temperature: opts.temperature ?? 0.1,
    ...opts,
  });
}

function createEvalLLM() {
  return new ChatOpenAI({
    model: CONFIG.model,
    apiKey: CONFIG.openaiApiKey,
    temperature: 0.0,
    maxTokens: 2000,
  });
}

// ---- Mode: Plan ----
// Read-only agent that analyzes code/PRs and suggests fixes
export function createPlanAgent() {
  return createReactAgent({
    llm: createLLM(),
    tools: PLAN_TOOLS,
    prompt: PLAN_PROMPT,
  });
}

// ---- Mode: Build ----
// Agent that makes edits to files and commits changes
export function createBuildAgent() {
  return createReactAgent({
    llm: createLLM(),
    tools: BUILD_TOOLS,
    prompt: BUILD_PROMPT,
  });
}

// ---- Mode: Auto Loop ----
// Self-improving agent that plans -> builds -> evaluates -> (retry or commit)
export function createAutoLoopAgent(opts = {}) {
  return createAutoLoopAgentInternal({
    llm: createLLM(),
    evalLLM: createEvalLLM(),
    maxRetries: opts.maxRetries || 3,
    minScore: opts.minScore || 7,
  });
}

export {
  createLLM,
  createEvalLLM,
  PLAN_PROMPT,
  BUILD_PROMPT,
  EVAL_PROMPT,
  CRITIQUE_PROMPT,
};