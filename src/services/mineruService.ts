/**
 * MinerU Service - Backend Integration Layer
 * 
 * This module provides the same interface as the original mineruService.ts
 * but delegates PDF extraction to the Python FastAPI backend.
 */

import { logger } from './logger';
import * as api from './apiClient';
import type { DocumentStructure } from '../types';

/**
 * Check if MinerU API key is configured on the backend
 */
export async function isMineruConfigured(): Promise<boolean> {
    try {
        const status = await api.getKeyStatus();
        return status.mineru_configured;
    } catch {
        return false;
    }
}

// Sync version for backwards compatibility (checks cached status)
let cachedMineruStatus = false;

export function isMineruConfiguredSync(): boolean {
    // Update cache async
    api.getKeyStatus().then(status => {
        cachedMineruStatus = status.mineru_configured;
    }).catch(() => { });

    return cachedMineruStatus;
}

/**
 * Extract structured content from PDF using MinerU via backend
 */
export async function extractWithMinerU(
    file: File,
    onProgress?: (current: number, total: number) => void
): Promise<DocumentStructure> {
    logger.debug('MinerU] Starting extraction via backend for:', file.name);

    if (onProgress) onProgress(0, 100);

    try {
        const result = await api.parsePdf(file, true);

        if (!result.success || !result.document) {
            throw new Error(result.error || 'MinerU extraction failed');
        }

        if (onProgress) onProgress(100, 100);

        logger.debug('MinerU] Extraction complete via backend, word count:', result.document.word_count);

        // Convert API response to frontend DocumentStructure format
        return {
            text: result.document.text,
            pages: result.document.pages,
            wordCount: result.document.word_count,
            language: result.document.language
        };

    } catch (error) {
        console.error('[MinerU] Backend extraction failed:', error);
        throw error;
    }
}
