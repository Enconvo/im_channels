import { Extension, IMChannelProvider } from "@enconvo/api";
import * as fs from "fs";
import * as path from "path";

export async function withRetry<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
    baseDelay = 1000
): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err: any) {
            lastError = err;
            const status = err?.status ?? err?.httpStatus ?? err?.code;
            if (status === 429 || err?.message?.includes?.("rate limit")) {
                const retryAfter = err?.retryAfter ?? err?.retry_after;
                const delay = retryAfter
                    ? retryAfter * 1000
                    : baseDelay * Math.pow(2, attempt);
                if (attempt < maxRetries) {
                    await sleep(delay);
                    continue;
                }
            }
            throw err;
        }
    }
    throw lastError;
}

export function splitMessage(content: string, maxLen: number): string[] {
    if (content.length <= maxLen) return [content];

    const chunks: string[] = [];
    let remaining = content;

    while (remaining.length > 0) {
        if (remaining.length <= maxLen) {
            chunks.push(remaining);
            break;
        }

        let splitIndex = -1;

        const newlineIndex = remaining.lastIndexOf("\n", maxLen);
        if (newlineIndex > maxLen * 0.3) {
            splitIndex = newlineIndex + 1;
        }

        if (splitIndex === -1) {
            const spaceIndex = remaining.lastIndexOf(" ", maxLen);
            if (spaceIndex > maxLen * 0.3) {
                splitIndex = spaceIndex + 1;
            }
        }

        if (splitIndex === -1) {
            splitIndex = maxLen;
        }

        chunks.push(remaining.slice(0, splitIndex));
        remaining = remaining.slice(splitIndex);
    }

    return chunks;
}

/**
 * Split text into chunks optimized for TTS streaming.
 * The first `fastChunkCount` chunks are single sentences (for low latency),
 * subsequent chunks are larger paragraphs.
 * Short sentences are merged to meet `minLen`.
 */
export function splitTextForTTS(
    text: string,
    { minLen = 20, fastChunkCount = 2, laterMaxLen = 200 } = {}
): string[] {
    // Split into sentences on: period/exclamation/question (incl. Chinese), newlines
    // Filter: must contain at least one word character (letters, digits, CJK, etc.)
    const hasSubstance = (s: string) => /[\w\u4e00-\u9fff\u3400-\u4dbf\uac00-\ud7af\u0400-\u04ff]/u.test(s);
    const sentences = text
        .split(/(?<=[.!?。！？\n])\s*/)
        .map(s => s.trim())
        .filter(s => s.length > 0 && hasSubstance(s));

    if (sentences.length === 0) return text.trim() ? [text.trim()] : [];

    const chunks: string[] = [];
    let i = 0;

    // First N chunks: one sentence each (merge short ones forward)
    while (i < sentences.length && chunks.length < fastChunkCount) {
        let chunk = sentences[i++];
        while (chunk.length < minLen && i < sentences.length) {
            chunk += " " + sentences[i++];
        }
        chunks.push(chunk);
    }

    // Remaining: merge into larger chunks
    let buffer = "";
    while (i < sentences.length) {
        const sentence = sentences[i++];
        if (buffer.length + sentence.length + 1 > laterMaxLen && buffer.length >= minLen) {
            chunks.push(buffer);
            buffer = sentence;
        } else {
            buffer = buffer ? buffer + " " + sentence : sentence;
        }
    }
    if (buffer) chunks.push(buffer);

    return chunks.filter(c => hasSubstance(c));
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

let _schemasCache: any[] | null = null;

function loadSchemas(): any[] {
    if (_schemasCache) return _schemasCache;
    const schemasPath = path.join(Extension.getExtensionPath("im_channels"), "skills", "schemas.json");
    try {
        _schemasCache = JSON.parse(fs.readFileSync(schemasPath, "utf-8"));
    } catch {
        _schemasCache = [];
    }
    return _schemasCache!;
}

/**
 * Load tool definitions from schemas.json for a given router name (e.g. "discord_actions").
 * Returns the routes as ToolDefinition[] with tool_name = routePath and description/parameters from JSDoc.
 */
export function loadToolsFromSchema(routerName: string): IMChannelProvider.ToolDefinition[] {
    const schemas = loadSchemas();
    const router = schemas.find((s: any) => s.name === routerName);
    if (!router?.routes) return [];

    return router.routes.map((route: any) => ({
        tool_name: route.routePath,
        description: route.description || "",
        parameters: route.parameters || { type: "object", properties: {}, required: [] },
    }));
}
