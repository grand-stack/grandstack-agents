// A ModelAdapter for Claude, using the Anthropic SDK. Needs ANTHROPIC_API_KEY. Not exercised by the tests (no live model call).
import Anthropic from "@anthropic-ai/sdk";
import type { Block, ModelAdapter } from "../../src/agent.js";

export function anthropicAdapter(options: { model?: string; maxTokens?: number } = {}): ModelAdapter {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY
  const model = options.model ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
  return {
    async next({ system, messages, tools }) {
      const response = await client.messages.create({
        model,
        max_tokens: options.maxTokens ?? 2048,
        system,
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as Anthropic.Tool.InputSchema })),
        messages: messages as Anthropic.MessageParam[],
      });
      const content: Block[] = [];
      for (const block of response.content) {
        if (block.type === "text") content.push({ type: "text", text: block.text });
        else if (block.type === "tool_use") content.push({ type: "tool_use", id: block.id, name: block.name, input: block.input as Record<string, unknown> });
      }
      return { content };
    },
  };
}
