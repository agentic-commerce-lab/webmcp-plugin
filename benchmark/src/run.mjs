import { mkdirSync, writeFileSync } from 'node:fs';
import { newSession } from './browser.mjs';
import { chatStep, modelName } from './llm.mjs';
import { createWebmcpArm } from './arms/webmcp.mjs';
import { createDomArm } from './arms/dom.mjs';
import { buildTasks } from './tasks.mjs';
import { config } from './config.mjs';

const args = process.argv.slice(2);
const ARM = readArg('--arm', process.env.ARM); // 'webmcp' | 'dom'
const RUNS = Number(readArg('--runs', String(config.runs)));
const ONLY = readArg('--tasks', ''); // comma-separated task ids, empty = all
const OUT = readArg('--out', `results/${ARM}-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);

function readArg(name, fallback) {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
}

if (!['webmcp', 'dom'].includes(ARM)) {
    console.error('Usage: node src/run.mjs --arm webmcp|dom [--runs 5] [--tasks id1,id2] [--out file.jsonl]');
    process.exit(1);
}

const FINISH_TOOL = {
    type: 'function',
    function: {
        name: 'finish',
        description: 'Call when the task is complete or you are certain it cannot be completed.',
        parameters: {
            type: 'object',
            properties: { reason: { type: 'string' } },
            required: ['reason'],
        },
    },
};

const SYSTEM_PROMPTS = {
    webmcp: `You are completing a task in an online shop (base URL: ${config.baseUrl}).
Use the provided shop tools to get information and perform actions. Do not guess URLs or product data; use the tools. When the task is complete, call finish.`,
    dom: `You are completing a task in an online shop (base URL: ${config.baseUrl}).
You browse the shop via page snapshots and actions. Call snapshot first and after every navigation to see the current page. Element ids (#n) refer to the most recent snapshot. When the task is complete, call finish.`,
};

async function runTask(task, runIndex) {
    const { browser, context, page } = await newSession(config.baseUrl);
    const ctx = { visited: new Set(), toolOutputs: [], pageBytes: 0 };
    const startedAt = Date.now();

    const record = {
        arm: ARM,
        task: task.id,
        run: runIndex,
        model: modelName,
        steps: 0,
        timeMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        peakInputTokens: 0,
        pageBytes: 0,
        success: false,
        errorClass: null,
    };

    try {
        page.on('framenavigated', (frame) => {
            if (frame === page.mainFrame()) ctx.visited.add(frame.url());
        });
        await page.goto('/', { waitUntil: 'load' });

        const arm = ARM === 'webmcp' ? await createWebmcpArm(page, ctx) : createDomArm(page, ctx);
        const tools = [...arm.tools, FINISH_TOOL];

        const messages = [
            { role: 'system', content: SYSTEM_PROMPTS[ARM] },
            { role: 'user', content: task.prompt },
        ];

        let finished = false;
        while (!finished && record.steps < config.maxSteps && Date.now() - startedAt < config.taskTimeoutMs) {
            const { message, usage } = await chatStep(messages, tools);
            record.steps++;
            record.inputTokens += usage.promptTokens;
            record.outputTokens += usage.completionTokens;
            record.peakInputTokens = Math.max(record.peakInputTokens, usage.promptTokens);
            messages.push(message);

            for (const call of message.tool_calls ?? []) {
                if (call.function.name === 'finish') {
                    finished = true;
                    continue;
                }
                let result;
                try {
                    result = await arm.executeTool(call.function.name, JSON.parse(call.function.arguments || '{}'));
                } catch (error) {
                    result = `Error: ${error.message}`;
                }
                messages.push({ role: 'tool', tool_call_id: call.id, content: String(result).slice(0, 20000) });
            }
        }

        if (!finished && record.errorClass === null) {
            record.errorClass = record.steps >= config.maxSteps ? 'step-limit' : 'timeout';
        }

        record.success = await task.check({ page, context, ctx, config }).catch(() => false);
    } catch (error) {
        record.errorClass = error.name ?? 'error';
    } finally {
        record.timeMs = Date.now() - startedAt;
        record.pageBytes = ctx.pageBytes;
        await browser.close();
    }

    return record;
}

const tasks = buildTasks(config).filter((t) => !ONLY || ONLY.split(',').includes(t.id));
mkdirSync('results', { recursive: true });

for (const task of tasks) {
    for (let run = 1; run <= RUNS; run++) {
        const record = await runTask(task, run);
        writeFileSync(OUT, JSON.stringify(record) + '\n', { flag: 'a' });
        console.log(
            `${ARM} ${task.id} run ${run}: ${record.success ? 'OK' : 'FAIL'} ` +
                `${(record.timeMs / 1000).toFixed(1)}s, ${record.steps} steps, ` +
                `${record.inputTokens}+${record.outputTokens} tokens` +
                (record.errorClass ? ` (${record.errorClass})` : ''),
        );
    }
}
