/**
 * Arm A: WebMCP.
 *
 * Exposes the tools the shop registered on document.modelContext as
 * function-calling tools. Tool schemas are read live from the page, so this
 * arm never hardcodes the plugin's tool surface.
 */

export async function createWebmcpArm(page, ctx) {
    await page.waitForFunction(
        () => {
            return typeof document.modelContext?.getTools === 'function' && document.modelContext.getTools().length > 0;
        },
        { timeout: 15000 },
    );

    const pageTools = await page.evaluate(() => {
        return document.modelContext.getTools().map((tool) => ({
            name: tool.name,
            description: tool.description ?? '',
            inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
        }));
    });

    const tools = pageTools.map((tool) => ({
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
        },
    }));

    async function executeTool(name, args) {
        const result = await page.evaluate(
            async ([toolName, input]) => {
                return document.modelContext.callTool(toolName, input);
            },
            [name, args ?? {}],
        );

        const serialized = JSON.stringify(result);
        ctx.pageBytes += serialized.length;
        ctx.toolOutputs.push(serialized);

        return serialized;
    }

    return { tools, executeTool };
}
