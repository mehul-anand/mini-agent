import OpenAI from "openai";
import { SYSTEM_PROMPT } from "../prompts/system.js";

/**
 * Stream a chat completion from OpenAI, invoking onToken for each delta.
 * Renderer-agnostic: the caller decides how to paint tokens.
 */
export async function streamChat({
  messages,
  model = "gpt-4o",
  apiKey,
  onToken,
  onDone,
  onError,
}) {
  const client = new OpenAI({ apiKey });

  let full = "";
  try {
    const stream = await client.chat.completions.create({
      model,
      messages,
      stream: true,
      temperature: 0.2,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        full += delta;
        onToken?.(delta);
      }
    }
    onDone?.(full);
    return full;
  } catch (err) {
    onError?.(err);
    throw err;
  }
}
