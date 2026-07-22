import OpenAI from 'openai';

/**
 * Thin OpenAI-chat-completions-compatible client.
 * Works with any provider exposing the standard API (set LLM_BASE_URL).
 *
 * Env:
 *   LLM_API_KEY   (required)
 *   LLM_BASE_URL  (optional, defaults to OpenAI)
 *   LLM_MODEL     (required, e.g. "gpt-4o-mini")
 */
const client = new OpenAI({
    apiKey: process.env.LLM_API_KEY,
    baseURL: process.env.LLM_BASE_URL,
});

const model = process.env.LLM_MODEL;

if (!model) {
    throw new Error('LLM_MODEL env var is required');
}

/**
 * One chat-completion step with tool calling.
 *
 * @param {Array} messages full conversation so far (mutated by caller only)
 * @param {Array} tools OpenAI-format tool definitions
 * @returns {Promise<{message: object, usage: {promptTokens: number, completionTokens: number}}>}
 */
export async function chatStep(messages, tools) {
    const response = await client.chat.completions.create({
        model,
        temperature: 0,
        messages,
        tools,
        tool_choice: 'auto',
    });

    const choice = response.choices[0];
    const usage = {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
    };

    return { message: choice.message, usage };
}

export const modelName = model;
