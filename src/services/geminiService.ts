/**
 * Gemini Service - Backend Integration Layer
 * 
 * This module provides the same interface as the original geminiService.ts
 * but delegates translation to the Python FastAPI backend.
 * 
 * The backend handles:
 * - API key management and rotation
 * - Rate limiting and retry logic
 * - Actual Gemini API calls
 */

import { logger } from './logger';
import * as api from './apiClient';
import type { GlossaryEntry, TermMatch, TranslatedChunk, Chunk } from '../types';

// Re-export types for backwards compatibility
export type { GlossaryEntry, TermMatch, TranslatedChunk, Chunk };

// ============ Cancellation Support ============
let abortController: AbortController | null = null;

export function cancelTranslation(): void {
    if (abortController) {
        abortController.abort();
        abortController = null;
    }
}

export function isTranslating(): boolean {
    return abortController !== null;
}// ============ API Key Management ============

interface ApiKeyConfig {
    key: string;
    isPaid: boolean;
}

// Track paid keys locally for UI logic
let localPaidKeys: string[] = [];
let localFreeKeys: string[] = [];

/**
 * Set API keys - sends to backend for storage
 */
export async function setApiKeys(keys: string[] | ApiKeyConfig[]): Promise<void> {
    // Normalize to ApiKeyConfig array
    const keyConfigs: ApiKeyConfig[] = keys.map(k =>
        typeof k === 'string' ? { key: k, isPaid: false } : k
    );

    localPaidKeys = keyConfigs.filter(k => k.isPaid).map(k => k.key);
    localFreeKeys = keyConfigs.filter(k => !k.isPaid).map(k => k.key);

    // DEBUG: Log each key with its status
    logger.debug('DEBUG KEYS Frontend] Configuring API keys:');
    keyConfigs.forEach((k, i) => {
        logger.log(`  Key ${i}: ${k.key.substring(0, 8)}...${k.key.slice(-4)} [${k.isPaid ? 'PAID' : 'FREE'}]`);
    });
    logger.log(`[DEBUG KEYS Frontend] Total: ${localPaidKeys.length} paid, ${localFreeKeys.length} free`);

    // Send all keys to backend (backend manages rotation)
    const keyStrings = keyConfigs.map(k => k.key);

    // Also send MinerU key if available from env
    const mineruKey = import.meta.env.VITE_MINERU_API_KEY;

    try {
        await api.setApiKeys(keyStrings, mineruKey || undefined);
        logger.log(`[DEBUG KEYS Frontend] Keys sent to backend successfully`);
        if (mineruKey) {
            logger.debug('DEBUG KEYS Frontend] MinerU key also sent to backend');
        }
    } catch (error) {
        logger.error('[DEBUG KEYS Frontend] Failed to set API keys on backend:', error);
        throw error;
    }
}

/**
 * Check if paid keys are available
 */
export function hasPaidKeys(): boolean {
    return localPaidKeys.length > 0;
}

/**
 * Skip to paid key - This is managed by backend key rotation
 * Returns true if paid keys exist
 */
export function skipToPaidKey(): boolean {
    if (localPaidKeys.length > 0) {
        logger.log('Paid keys available - backend will use them after free keys exhaust');
        return true;
    }
    return false;
}

// ============ Translation ============



/**
 * Identify glossary terms in text using word boundaries
 */
export function identifyTermsInText(
    text: string,
    glossary: GlossaryEntry[]
): TermMatch[] {
    const matches: TermMatch[] = [];
    const textLower = text.toLowerCase();

    const sortedGlossary = [...glossary].sort((a, b) => b.english.length - a.english.length);

    for (const entry of sortedGlossary) {
        const termLower = entry.english.toLowerCase();
        const escapedTerm = termLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escapedTerm}\\b`, 'gi');

        let match;
        const positions: number[] = [];

        while ((match = regex.exec(textLower)) !== null) {
            positions.push(match.index);
        }

        if (positions.length > 0) {
            matches.push({
                english: entry.english,
                chinese: entry.chinese,
                positions,
                source: 'glossary'
            });
        }
    }

    return matches;
}

/**
 * Convert frontend Chunk format to API format
 */
function toApiChunk(chunk: Chunk): api.Chunk {
    return {
        id: chunk.id,
        content: chunk.text,
        index: chunk.position
    };
}

/**
 * Convert frontend glossary to API format
 */
function toApiGlossary(glossary: GlossaryEntry[]): api.GlossaryEntry[] {
    return glossary.map(g => ({
        english: g.english,
        chinese: g.chinese
    }));
}

/**
 * Convert API TranslatedChunk to frontend format
 */
function fromApiChunk(apiChunk: api.TranslatedChunk, originalChunk: Chunk, glossary: GlossaryEntry[]): TranslatedChunk {
    // Re-identify terms for frontend display
    const matchedTerms = identifyTermsInText(originalChunk.text, glossary);

    return {
        ...originalChunk,
        translation: apiChunk.translated,
        matchedTerms,
        newTerms: [],
        tokenUsage: apiChunk.tokens_used ? {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: apiChunk.tokens_used
        } : undefined
    };
}

/**
 * Translate a single chunk via backend API
 */
export async function translateChunk(
    chunk: Chunk,
    glossary: GlossaryEntry[],
    onStatusUpdate?: (status: string) => void
): Promise<TranslatedChunk> {
    if (onStatusUpdate) {
        onStatusUpdate(`Translating chunk ${chunk.id}...`);
    }

    try {
        const result = await api.translateChunk(
            toApiChunk(chunk),
            toApiGlossary(glossary)
        );

        return fromApiChunk(result, chunk, glossary);
    } catch (error) {
        logger.error(`Failed to translate chunk ${chunk.id}:`, error);
        throw error;
    }
}

/**
 * Batch translate multiple chunks with progress tracking via SSE streaming
 */
export async function translateChunks(
    chunks: Chunk[],
    glossary: GlossaryEntry[],
    onProgress?: (current: number, total: number) => void,
    onStatusUpdate?: (status: string) => void,
    onChunkComplete?: (chunk: TranslatedChunk) => void
): Promise<TranslatedChunk[]> {
    if (onStatusUpdate) {
        onStatusUpdate('Starting translation via backend...');
    }

    // Ensure keys are synced to backend (in case backend was restarted)
    const allKeys = [...localFreeKeys, ...localPaidKeys];
    if (allKeys.length > 0) {
        logger.log('[translateChunks] Re-syncing keys to backend before translation...');
        await api.setApiKeys(allKeys, import.meta.env.VITE_MINERU_API_KEY || undefined);
        logger.log('[translateChunks] Keys synced, proceeding with translation');
    }

    // Create a map for quick chunk lookup
    const chunkMap = new Map(chunks.map(c => [c.id, c]));

    try {
        const apiResults = await api.translateBatchStreaming(
            chunks.map(toApiChunk),
            toApiGlossary(glossary),
            onProgress,
            (apiChunk) => {
                // Convert API chunk to frontend format and notify
                const originalChunk = chunkMap.get(apiChunk.id);
                if (originalChunk && onChunkComplete) {
                    const frontendChunk = fromApiChunk(apiChunk, originalChunk, glossary);
                    onChunkComplete(frontendChunk);
                }
            },
            (chunkId, error) => {
                logger.error(`Translation error for chunk ${chunkId}:`, error);
                if (onStatusUpdate) {
                    onStatusUpdate(`Error translating chunk ${chunkId}: ${error}`);
                }
            }
        );

        // Convert all results to frontend format
        return apiResults.map(apiChunk => {
            const originalChunk = chunkMap.get(apiChunk.id);
            if (!originalChunk) {
                logger.warn(`Original chunk not found for ID: ${apiChunk.id}`);
                // Return a minimal TranslatedChunk
                return {
                    id: apiChunk.id,
                    text: apiChunk.original,
                    position: 0,
                    type: 'paragraph' as const,
                    translation: apiChunk.translated,
                    matchedTerms: [],
                    newTerms: []
                };
            }
            return fromApiChunk(apiChunk, originalChunk, glossary);
        });

    } catch (error) {
        logger.error('Batch translation failed:', error);

        // Return error chunks for all
        return chunks.map(chunk => ({
            ...chunk,
            translation: `[Error: ${error instanceof Error ? error.message : 'Unknown error'}]`,
            matchedTerms: [],
            newTerms: []
        }));
    }
}

/**
 * Calculate glossary coverage statistics
 */
export function calculateCoverage(
    translatedChunks: TranslatedChunk[],
    glossary: GlossaryEntry[]
): { matched: number; total: number; percentage: number } {
    const matchedTermSet = new Set<string>();

    for (const chunk of translatedChunks) {
        for (const match of chunk.matchedTerms) {
            matchedTermSet.add(match.english.toLowerCase());
        }
    }

    const matched = matchedTermSet.size;
    const total = glossary.length;
    const percentage = total > 0 ? Math.round((matched / total) * 100) : 0;

    return { matched, total, percentage };
}
