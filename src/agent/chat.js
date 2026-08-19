import OpenAI from "openai";

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

export const SYSTEM_PROMPT = `You are AI Studio, a terminal coding agent. Help the user with software engineering tasks: writing, editing, debugging, and explaining code. Be concise and direct. Use Markdown, and always put code in fenced blocks with a language tag. Do not invent file paths or APIs unless the user provided them.`;
