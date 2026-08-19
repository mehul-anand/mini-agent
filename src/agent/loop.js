import OpenAI from "openai";
import { toolsForMode, toOpenAISchema, executeToolCall } from "../tools/index.js";

const MAX_ITERATIONS = 10;

/**
 * Run a streaming tool-calling loop.
 *
 * - Streams assistant text tokens to `onToken`.
 * - When the model emits tool calls, executes them (via tools.js) and feeds
 *   observations back, then loops. Renders tool activity via onToolCall/onObservation.
 * - Stops when the model returns text with no tool calls, or hits MAX_ITERATIONS.
 *
 * Callbacks:
 *   onToken(token)            — assistant text delta
 *   onToolCall(name, args)    — a tool was requested (for UI)
 *   onObservation(name, out)  — tool result returned (for UI)
 *   onDone()                  — loop finished
 *   onError(err)              — fatal error
 */
export async function runAgentLoop({
  messages,
  model = "gpt-4o",
  apiKey,
  mode = "PLAN",
  onToken,
  onToolCall,
  onObservation,
  onDone,
  onError,
}) {
  const client = new OpenAI({ apiKey });
  const tools = toolsForMode(mode).map(toOpenAISchema);
  const toolChoice = tools.length ? "auto" : "none";

  let conversation = messages.slice();
  let iterations = 0;

  try {
    while (iterations < MAX_ITERATIONS) {
      iterations++;
      const stream = await client.chat.completions.create({
        model,
        messages: conversation,
        tools,
        toolChoice,
        stream: true,
        temperature: 0.2,
      });

      let content = "";
      const toolCalls = []; // { index, id, name, arguments }

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          content += delta.content;
          onToken?.(delta.content);
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const slot = toolCalls[tc.index] || (toolCalls[tc.index] = { id: "", name: "", arguments: "" });
            if (tc.id) slot.id = tc.id;
            if (tc.function?.name) slot.name = tc.function.name;
            if (tc.function?.arguments) slot.arguments += tc.function.arguments;
          }
        }
      }

      // No tool calls → final answer, we're done.
      if (toolCalls.length === 0) {
        onDone?.();
        return;
      }

      // Record the assistant turn (including its tool_calls) for the next request.
      conversation.push({
        role: "assistant",
        content: content || null,
        tool_calls: toolCalls
          .filter(Boolean)
          .map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: tc.arguments },
          })),
      });

      // Execute each tool call and append observations.
      for (const tc of toolCalls.filter(Boolean)) {
        onToolCall?.(tc.name, tc.arguments);
        let output;
        try {
          output = await executeToolCall({ function: { name: tc.name, arguments: tc.arguments } });
        } catch (err) {
          output = `Tool error: ${err?.message || String(err)}`;
        }
        onObservation?.(tc.name, output);
        conversation.push({
          role: "tool",
          tool_call_id: tc.id,
          content: output,
        });
      }
    }

    onError?.(new Error(`Reached max tool iterations (${MAX_ITERATIONS})`));
  } catch (err) {
    onError?.(err);
    throw err;
  }
}
