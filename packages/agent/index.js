import { SYSTEM_PROMPT, TOOL_DEFINITIONS } from "@fca/prompts";
import { executeTool } from "@fca/tools";

const MAX_TURNS = 6;

async function callClaude(messages, apiKey) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOL_DEFINITIONS,
      messages
    })
  });

  if (!res.ok) throw new Error(`Claude API error ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Main export ───────────────────────────────────────────────
// callbacks:
//   onToolSpawn(toolCall)          → Claude decided to call a tool
//   onToolResult(toolCall, result) → API responded, card can update
//   onThinking(text)               → Claude text between rounds
//   onError(err)                   → something failed

export async function runAgent(tip, apiKey, callbacks = {}) {
  const { onToolSpawn, onToolResult, onThinking, onError } = callbacks;
  const messages = [{ role: "user", content: tip }];
  let turn = 0;

  while (turn < MAX_TURNS) {
    turn++;

    let response;
    try {
      response = await callClaude(messages, apiKey);
    } catch (err) {
      onError?.(err);
      return { error: err.message };
    }

    const toolCalls = response.content.filter(b => b.type === "tool_use");
    const textBlocks = response.content.filter(b => b.type === "text");

    if (textBlocks.length > 0) onThinking?.(textBlocks.map(b => b.text).join("\n"));

    // no tool calls = final synthesis
    if (toolCalls.length === 0) {
      const raw = textBlocks.map(b => b.text).join("\n");
      try {
        const match = raw.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : { raw };
      } catch {
        return { raw };
      }
    }

    // notify UI → spawn cards
    toolCalls.forEach(tc => onToolSpawn?.(tc));

    // execute all in parallel
    const results = await Promise.all(toolCalls.map(tc => executeTool(tc)));

    // notify UI → update cards with results
    toolCalls.forEach((tc, i) => onToolResult?.(tc, results[i]));

    // append to history
    messages.push({ role: "assistant", content: response.content });
    messages.push({
      role: "user",
      content: toolCalls.map((tc, i) => ({
        type: "tool_result",
        tool_use_id: tc.id,
        content: JSON.stringify(results[i])
      }))
    });
  }

  return { error: "Agent exceeded maximum turns" };
}
