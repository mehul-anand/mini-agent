import {
  Annotation,
  StateGraph,
  START,
  END,
  Command,
  MemorySaver,
} from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import { PLAN_PROMPT, BUILD_PROMPT, EVAL_PROMPT } from "../prompts/index.js";
import { PLAN_TOOLS, BUILD_TOOLS } from "../tools/index.js";
import { executeCmdTool, gitDiffTool, gitCommitTool } from "../tools/index.js";

// ---- State schema for the auto loop ----
const AutoLoopState = Annotation.Root({
  messages: Annotation({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  issue: Annotation({
    reducer: (x, y) => y ?? x ?? "",
    default: () => "",
  }),
  fixPlan: Annotation({
    reducer: (x, y) => y ?? x ?? "",
    default: () => "",
  }),
  retryCount: Annotation({
    reducer: (x, y) => y ?? x ?? 0,
    default: () => 0,
  }),
  evalScore: Annotation({
    reducer: (x, y) => y ?? x ?? 0,
    default: () => 0,
  }),
  evalFeedback: Annotation({
    reducer: (x, y) => y ?? x ?? "",
    default: () => "",
  }),
  done: Annotation({
    reducer: (x, y) => y ?? x ?? false,
    default: () => false,
  }),
});

// ---- Node: Plan ----
async function planNode(state, context) {
  const { planAgent } = context;
  const result = await planAgent.invoke({
    messages: [new HumanMessage(`Analyze this issue and produce a concrete fix plan:\n\n${state.issue}`)],
  });

  const msgs = result.messages || [];
  const lastMsg = msgs[msgs.length - 1];
  const plan = lastMsg?.content || "";

  console.log("\n📋 PLAN:\n" + plan + "\n");

  return {
    fixPlan: plan,
    messages: msgs,
  };
}

// ---- Node: Build ----
async function buildNode(state, context) {
  const { buildAgent } = context;
  let input;
  if (state.retryCount > 0 && state.evalFeedback) {
    input = `The previous fix attempt was evaluated as insufficient.\n\nFeedback: ${state.evalFeedback}\n\nOriginal issue:\n${state.issue}\n\nPlan:\n${state.fixPlan}\n\nRetry: improve the fix based on the feedback.`;
  } else {
    input = `Implement this fix plan:\n\n${state.fixPlan}\n\nIssue:\n${state.issue}`;
  }

  console.log("🔨 BUILD: implementing fix...");
  const result = await buildAgent.invoke({
    messages: [new HumanMessage(input)],
  });

  const msgs = result.messages || [];
  console.log("✓ BUILD complete\n");

  return {
    messages: msgs,
  };
}

// ---- Node: Evaluate ----
async function evaluateNode(state, context) {
  const { evalLLM, minScore } = context;

  console.log("🔍 EVALUATE: checking results...");

  // Run lint
  let lintOutput = "No lint script found";
  try {
    lintOutput = await executeCmdTool.invoke({ cmd: "npm run lint 2>&1" });
  } catch (e) {
    lintOutput = `Lint failed: ${e.message}`;
  }

  // Get current diff
  const diff = await gitDiffTool.invoke({ target: "working" });

  // Run tests if available
  let testOutput = "No tests run";
  try {
    testOutput = await executeCmdTool.invoke({ cmd: "npm test 2>&1" });
  } catch (e) {
    testOutput = `Tests failed: ${e.message}`;
  }

  // LLM evaluation
  const evalPrompt = `
ISSUE:
${state.issue}

PROPOSED DIFF:
${diff}

LINT OUTPUT:
${lintOutput}

TEST OUTPUT:
${testOutput}

Evaluate whether the changes correctly address the issue. Return valid JSON only.
`;

  const response = await evalLLM.invoke([
    new SystemMessage(EVAL_PROMPT),
    new HumanMessage(evalPrompt),
  ]);

  let score = 0;
  let feedback = "";
  try {
    const parsed = JSON.parse(response.content || "");
    score = parsed.score || 0;
    feedback = parsed.reasoning || "";
  } catch {
    score = response.content?.includes('"score"') ? 5 : 3;
    feedback = response.content || "Could not parse evaluation";
  }

  console.log(`📊 Evaluation score: ${score}/10\n`);

  return {
    evalScore: score,
    evalFeedback: feedback,
  };
}

// ---- Node: Commit ----
async function commitNode(state) {
  const msg = `auto-fix: ${state.issue.slice(0, 60)}`;
  console.log("✅ COMMIT: saving fix...");
  await gitCommitTool.invoke({ message: msg });
  console.log("✓ Changes committed\n");
  return { done: true };
}

// ---- Node: Escalate ----
async function escalateNode(state) {
  console.log("⚠️ ESCALATE: max retries reached, could not fix satisfactorily");
  console.log(`   Last feedback: ${state.evalFeedback.slice(0, 200)}\n`);
  return { done: true };
}

// ---- Routing: after evaluation ----
function routeAfterEval(maxRetries, minScore) {
  return (state) => {
    if (state.evalScore >= minScore) {
      return "commit";
    }
    if (state.retryCount < maxRetries) {
      return new Command({
        goto: "build",
        update: { retryCount: state.retryCount + 1 },
      });
    }
    return "escalate";
  };
}

// ---- Graph factory ----
export function createAutoLoopAgent(params = {}) {
  const llm = params.llm || new ChatOpenAI({ model: params.model || "gpt-4o", apiKey: params.openaiApiKey, temperature: 0.1 });
  const evalLLM = params.evalLLM || new ChatOpenAI({ model: params.model || "gpt-4o", apiKey: params.openaiApiKey, temperature: 0 });
  const maxRetries = params.maxRetries || 3;
  const minScore = params.minScore || 7;

  // Create the sub-agents (closed over in node closures)
  const planAgent = createReactAgent({ llm, tools: PLAN_TOOLS, prompt: PLAN_PROMPT });
  const buildAgent = createReactAgent({ llm, tools: BUILD_TOOLS, prompt: BUILD_PROMPT });

  const context = { planAgent, buildAgent, evalLLM, minScore };

  const workflow = new StateGraph(AutoLoopState)
    .addNode("planning", (s) => planNode(s, context))
    .addNode("build", (s) => buildNode(s, context))
    .addNode("evaluate", (s) => evaluateNode(s, context))
    .addNode("commit", commitNode)
    .addNode("escalate", escalateNode)
    .addEdge(START, "planning")
    .addEdge("planning", "build")
    .addEdge("build", "evaluate")
    .addConditionalEdges("evaluate", routeAfterEval(maxRetries, minScore), {
      commit: "commit",
      build: "build",
      escalate: "escalate",
    })
    .addEdge("commit", END)
    .addEdge("escalate", END);

  return workflow.compile({ checkpointer: new MemorySaver() });
}