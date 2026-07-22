import { readFileSync, readdirSync } from 'node:fs';

/**
 * Aggregates all results/*.jsonl files into one markdown table:
 * median time, tokens, steps, page bytes and success rate per task x arm.
 *
 * Usage: node src/report.mjs [resultsDir]
 */

const dir = process.argv[2] ?? 'results';
const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));

if (files.length === 0) {
    console.error(`No .jsonl files in ${dir}/`);
    process.exit(1);
}

const records = files.flatMap((f) => {
    return readFileSync(`${dir}/${f}`, 'utf8').trim().split('\n').map(JSON.parse);
});

const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const groups = new Map();
for (const r of records) {
    const key = `${r.task}|${r.arm}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
}

console.log(
    '| Task | Arm | Runs | Success | Median time (s) | Median steps | Median input tok | Median output tok | Median peak input tok | Median page bytes |',
);
console.log('|---|---|---|---|---|---|---|---|---|---|');

for (const [key, rs] of [...groups.entries()].sort()) {
    const [task, arm] = key.split('|');
    const success = rs.filter((r) => r.success).length;
    console.log(
        `| ${task} | ${arm} | ${rs.length} | ${success}/${rs.length} ` +
            `| ${(median(rs.map((r) => r.timeMs)) / 1000).toFixed(1)} ` +
            `| ${median(rs.map((r) => r.steps))} ` +
            `| ${median(rs.map((r) => r.inputTokens))} ` +
            `| ${median(rs.map((r) => r.outputTokens))} ` +
            `| ${median(rs.map((r) => r.peakInputTokens))} ` +
            `| ${median(rs.map((r) => r.pageBytes))} |`,
    );
}
