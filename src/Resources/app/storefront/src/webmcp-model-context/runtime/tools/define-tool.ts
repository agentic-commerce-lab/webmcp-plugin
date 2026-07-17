import { z } from 'zod';
import type { ModelContextTool, ToolResult, UnknownRecord } from '../types';

export interface ToolAnnotations {
    /** The tool only reads state and never mutates the cart or session. */
    readOnlyHint?: boolean;
    /** The tool returns externally sourced content (e.g. product text) that may carry prompt-injection. */
    untrustedContentHint?: boolean;
}

export interface ToolDefinition<TInput extends z.ZodType> {
    name: string;
    title: string;
    description: string;
    input: TInput;
    annotations?: ToolAnnotations;
    execute: (input: z.output<TInput>) => Promise<ToolResult>;
}

/**
 * Builds a WebMCP tool from a single zod input schema. The schema is the one
 * source of truth: it produces both the runtime validator and the JSON Schema
 * advertised to agents, so the two cannot drift.
 */
export function defineTool<TInput extends z.ZodType>(definition: ToolDefinition<TInput>): ModelContextTool {
    const inputSchema = toInputSchema(definition.input);

    const run = async (rawInput: unknown = {}): Promise<ToolResult> => {
        const parsed = definition.input.safeParse(rawInput ?? {});

        if (!parsed.success) {
            throw new Error(`${definition.title} input is invalid: ${formatIssues(parsed.error)}`);
        }

        return definition.execute(parsed.data);
    };

    return {
        name: definition.name,
        title: definition.title,
        description: definition.description,
        inputSchema,
        ...(definition.annotations ? { annotations: { ...definition.annotations } } : {}),
        execute: run,
        handler: run,
    };
}

/**
 * Converts a zod schema to a JSON Schema for the tool contract. zod refinements
 * (e.g. "exactly one of id/sku/url") are runtime-only and are not emitted, so the
 * result is always a plain top-level object — which function-calling APIs require.
 */
function toInputSchema(input: z.ZodType): UnknownRecord {
    const schema = z.toJSONSchema(input, { io: 'input' }) as UnknownRecord;

    delete schema.$schema;

    if (schema.type === 'object' && schema.additionalProperties === undefined) {
        schema.additionalProperties = false;
    }

    return schema;
}

function formatIssues(error: z.ZodError): string {
    return error.issues
        .map((issue) => {
            const path = issue.path.join('.');

            return path ? `${path}: ${issue.message}` : issue.message;
        })
        .join('; ');
}
