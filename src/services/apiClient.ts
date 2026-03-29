/**
 * API Client for Backend Communication
 * 
 * Handles all HTTP requests to the FastAPI backend.
 * Supports both development (localhost:8000) and Tauri production modes.
 */

// Backend base URL - changes based on environment
// ============ Logging ============
import { logger } from './logger';

const getBackendUrl = (): string => {
    // Check if running in Tauri
    if (typeof window !== 'undefined' && '__TAURI__' in window) {
        // Tauri: backend runs as sidecar on dynamic port
        // This will be replaced with actual sidecar port detection
        return 'http://localhost:8000';
    }

    // Development mode or web: use Vite proxy or direct URL
    return import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
};

export const API_BASE = getBackendUrl();

/**
 * Generic fetch wrapper with error handling
 */
async function apiFetch<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const url = `${API_BASE}${endpoint}`;

    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });

    if (!response.ok) {
        let errorMessage: string;
        try {
            const errorData = await response.json();
            errorMessage = errorData.detail || errorData.message || errorData.error || `HTTP ${response.status}`;
        } catch {
            errorMessage = await response.text() || `HTTP ${response.status}`;
        }

        const statusMessages: Record<number, string> = {
            400: 'Invalid request. Please check your input.',
            401: 'Authentication failed. Please check your API key.',
            403: 'Access denied.',
            404: 'Service endpoint not found. Is the backend running?',
            429: 'Rate limit exceeded. Please wait and try again.',
            500: 'Server error. Please try again later.',
            502: 'Backend is not responding. Please check if the server is running.',
            503: 'Service temporarily unavailable.',
        };

        const friendlyMessage = statusMessages[response.status];
        throw new Error(friendlyMessage ? `${friendlyMessage} (${errorMessage})` : `API Error: ${errorMessage}`);
    }

    return response.json();
}

// ============ API Keys ============

export interface ApiKeyStatus {
    gemini_configured: boolean;
    gemini_key_count: number;
    mineru_configured: boolean;
}

export async function setApiKeys(
    geminiKeys?: string[],
    mineruKey?: string
): Promise<ApiKeyStatus> {
    return apiFetch<ApiKeyStatus>('/api/keys', {
        method: 'POST',
        body: JSON.stringify({
            gemini_keys: geminiKeys,
            mineru_key: mineruKey,
        }),
    });
}

export async function getKeyStatus(): Promise<ApiKeyStatus> {
    return apiFetch<ApiKeyStatus>('/api/keys/status');
}

export interface GeminiTestResult {
    status: 'ok' | 'error' | 'rate_limited' | 'no_key';
    message: string;
    rate_limited: boolean;
    response?: string;
}

export async function testGemini(): Promise<GeminiTestResult> {
    return apiFetch<GeminiTestResult>('/api/keys/test-gemini');
}

// ============ Document Parsing ============

export interface DocumentStructure {
    text: string;
    pages: number;
    word_count: number;
    language: 'en' | 'zh' | 'unknown';
}

export interface ParseResult {
    success: boolean;
    document?: DocumentStructure;
    /** Backend DB ID of the created document — used for Markdown export. */
    doc_id?: number;
    error?: string;
}

export async function parsePdf(
    file: File,
    useMinerU: boolean = true
): Promise<ParseResult> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('use_mineru', String(useMinerU));

    const response = await fetch(`${API_BASE}/api/parse/pdf`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Parse Error (${response.status}): ${errorText}`);
    }

    return response.json();
}

export async function parseMarkdown(file: File): Promise<ParseResult> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE}/api/parse/markdown`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Parse Error (${response.status}): ${errorText}`);
    }

    return response.json();
}

// ============ Translation ============

export interface GlossaryEntry {
    english: string;
    chinese: string;
}

export interface Chunk {
    id: string;
    content: string;
    index: number;
}

export interface TermMatch {
    term: string;
    translation: string;
    start_index: number;
    end_index: number;
}

export interface TranslatedChunk {
    id: string;
    original: string;
    translated: string;
    terms_used: TermMatch[];
    tokens_used?: number;
}

export interface TranslationProgress {
    event: 'progress' | 'chunk_complete' | 'error' | 'done';
    chunk_id?: string;
    current: number;
    total: number;
    translated_chunk?: TranslatedChunk;
    error_message?: string;
}

/**
 * Translate a single chunk
 */
export async function translateChunk(
    chunk: Chunk,
    glossary: GlossaryEntry[]
): Promise<TranslatedChunk> {
    return apiFetch<TranslatedChunk>('/api/translate/chunk', {
        method: 'POST',
        body: JSON.stringify({
            chunk,
            glossary,
        }),
    });
}

/**
 * Batch translate with SSE streaming
 * 
 * @param chunks - Array of chunks to translate
 * @param glossary - Glossary terms to enforce
 * @param onProgress - Callback for progress updates
 * @param onChunkComplete - Callback when a chunk finishes
 * @param onError - Callback for errors
 */
export async function translateBatchStreaming(
    chunks: Chunk[],
    glossary: GlossaryEntry[],
    onProgress?: (current: number, total: number) => void,
    onChunkComplete?: (chunk: TranslatedChunk) => void,
    onError?: (chunkId: string, error: string) => void
): Promise<TranslatedChunk[]> {
    const response = await fetch(`${API_BASE}/api/translate/batch`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
            chunks,
            glossary,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Translation Error (${response.status}): ${errorText}`);
    }

    logger.debug('SSE] Response received:', {
        status: response.status,
        contentType: response.headers.get('content-type'),
        ok: response.ok
    });

    const results: TranslatedChunk[] = [];
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
        throw new Error('No response body for SSE stream');
    }

    let buffer = '';

    // Helper function to extract and parse all JSON events from buffer
    const extractEvents = (text: string): { events: TranslationProgress[], remaining: string } => {
        const events: TranslationProgress[] = [];
        let remaining = text;

        // Find all JSON objects in the text
        const regex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
        let match;
        let lastIndex = 0;

        while ((match = regex.exec(text)) !== null) {
            try {
                const parsed = JSON.parse(match[0]) as TranslationProgress;
                if (parsed.event) {
                    events.push(parsed);
                    lastIndex = regex.lastIndex;
                }
            } catch (e) {
                // Not valid JSON, skip
            }
        }

        // Keep any remaining text after the last parsed event
        remaining = text.substring(lastIndex);

        return { events, remaining };
    };

    // Process a list of events
    const processEvents = (events: TranslationProgress[]) => {
        for (const event of events) {
            logger.debug('SSE] Event:', event.event, event.chunk_id);

            switch (event.event) {
                case 'progress':
                    onProgress?.(event.current, event.total);
                    break;

                case 'chunk_complete':
                    if (event.translated_chunk) {
                        logger.debug('SSE] Chunk translated:', event.translated_chunk.id,
                            'Length:', event.translated_chunk.translated?.length);
                        results.push(event.translated_chunk);
                        onChunkComplete?.(event.translated_chunk);
                    }
                    onProgress?.(event.current, event.total);
                    break;

                case 'error':
                    console.error('[SSE] Translation error:', event.error_message);
                    onError?.(event.chunk_id || 'unknown', event.error_message || 'Unknown error');
                    break;

                case 'done':
                    logger.debug('SSE] Translation complete, total chunks:', results.length);
                    break;
            }
        }
    };

    while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Try to extract and process events from buffer
        const { events, remaining } = extractEvents(buffer);
        if (events.length > 0) {
            processEvents(events);
        }
        buffer = remaining;
    }

    // Process any remaining events in the buffer
    if (buffer.trim()) {
        logger.debug('SSE] Processing remaining buffer...');
        const { events } = extractEvents(buffer);
        if (events.length > 0) {
            processEvents(events);
        }
    }

    logger.debug('SSE] Returning results:', results.length, 'chunks');
    return results;
}

/**
 * Synchronous batch translate (no streaming)
 */
export async function translateBatchSync(
    chunks: Chunk[],
    glossary: GlossaryEntry[]
): Promise<TranslatedChunk[]> {
    return apiFetch<TranslatedChunk[]>('/api/translate/batch/sync', {
        method: 'POST',
        body: JSON.stringify({
            chunks,
            glossary,
        }),
    });
}

// ============ Health Check ============

export async function healthCheck(): Promise<{ status: string }> {
    return apiFetch<{ status: string }>('/health');
}

// ============ PDF Export ============

export interface ExportPdfChunk {
    id: string;
    text: string;
    translation: string;
    type: 'heading' | 'paragraph' | 'list' | 'table';
    position: number;
}

export interface ExportPdfRequest {
    chunks: ExportPdfChunk[];
    title: string;
    include_original?: boolean;
}

/**
 * Export translation to text-based PDF via backend.
 * Returns a Blob that can be downloaded.
 */
export async function exportPdf(request: ExportPdfRequest): Promise<Blob> {
    const response = await fetch(`${API_BASE}/api/export/pdf`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`PDF Export Error (${response.status}): ${errorText}`);
    }

    return response.blob();
}

/**
 * Export translation back to Markdown using the Skeleton+State pattern.
 * Performs a deterministic tag replacement on the stored skeleton.
 * Returns a Blob that can be downloaded as a .md file.
 */
export async function exportMarkdown(
    documentId: number,
    includeUntranslated: boolean = true
): Promise<Blob> {
    const url = `${API_BASE}/api/export/markdown/${documentId}?include_untranslated=${includeUntranslated}`;
    const response = await fetch(url);

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Markdown Export Error (${response.status}): ${errorText}`);
    }

    return response.blob();
}

// ============ Glossary Management ============

export interface GlossaryTerm {
    id?: number;
    english: string;
    chinese: string;
    notes?: string;
    category?: string;
}

export interface GlossaryUploadResult {
    success: boolean;
    terms_added: number;
    terms_updated: number;
    errors: string[];
}

/**
 * Upload a CSV file with glossary terms
 */
export async function uploadGlossary(file: File): Promise<GlossaryUploadResult> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE}/api/glossary/upload`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Glossary upload failed: ${errorText}`);
    }

    return response.json();
}

/**
 * List all glossary terms with optional filters
 */
export async function listGlossary(
    category?: string,
    search?: string
): Promise<GlossaryTerm[]> {
    const params = new URLSearchParams();
    if (category) params.append('category', category);
    if (search) params.append('search', search);

    const queryString = params.toString();
    const url = queryString ? `/api/glossary?${queryString}` : '/api/glossary';

    return apiFetch<GlossaryTerm[]>(url);
}

/**
 * Get all unique categories
 */
export async function listGlossaryCategories(): Promise<string[]> {
    return apiFetch<string[]>('/api/glossary/categories');
}

/**
 * Create a new glossary term
 */
export async function createGlossaryTerm(term: GlossaryTerm): Promise<GlossaryTerm> {
    return apiFetch<GlossaryTerm>('/api/glossary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(term),
    });
}

/**
 * Update an existing glossary term
 */
export async function updateGlossaryTerm(id: number, term: GlossaryTerm): Promise<GlossaryTerm> {
    return apiFetch<GlossaryTerm>(`/api/glossary/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(term),
    });
}

/**
 * Delete a glossary term
 */
export async function deleteGlossaryTerm(id: number): Promise<void> {
    await apiFetch(`/api/glossary/${id}`, { method: 'DELETE' });
}

/**
 * Clear all glossary terms (use with caution!)
 */
export async function clearGlossary(): Promise<void> {
    await apiFetch('/api/glossary/clear', { method: 'DELETE' });
}

// ============ Review Queue ============

export interface ReviewNode {
    id: number;
    document_id: number;
    index: number;
    content: string;
    translation: string | null;
    state: 'pending' | 'translating' | 'review' | 'approved' | 'completed' | 'failed';
    confidence: number | null;
    block_type: string;
    created_at: string;
    updated_at: string;
}

export interface DocumentStats {
    total_nodes: number;
    pending: number;
    translating: number;
    review: number;
    approved: number;
    completed: number;
    failed: number;
    progress_percent: number;
}

/**
 * Get nodes needing review
 */
export async function getReviewQueue(documentId?: number): Promise<ReviewNode[]> {
    const url = documentId
        ? `/api/review/queue?document_id=${documentId}`
        : '/api/review/queue';
    return apiFetch<ReviewNode[]>(url);
}

/**
 * Approve a node's translation
 */
export async function approveNode(nodeId: number): Promise<void> {
    await apiFetch(`/api/review/${nodeId}/approve`, { method: 'POST' });
}

/**
 * Edit a node's translation
 */
export async function editNode(nodeId: number, translation: string): Promise<void> {
    await apiFetch(`/api/review/${nodeId}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ translation }),
    });
}

/**
 * Request re-translation of a node
 */
export async function retranslateNode(nodeId: number): Promise<void> {
    await apiFetch(`/api/review/${nodeId}/retranslate`, { method: 'POST' });
}

/**
 * Get document translation statistics
 */
export async function getDocumentStats(documentId: number): Promise<DocumentStats> {
    return apiFetch<DocumentStats>(`/api/review/stats/${documentId}`);
}

// ============ Chunk Synchronization ============

export interface BackendChunk {
    chunk_tag: string;
    content: string;
    index: number;
    translation?: string;
    state?: string;
    node_id: number;
}

export interface ChunkSyncResponse {
    document_id: number;
    document_name: string;
    skeleton: string;
    chunks: BackendChunk[];
}

/**
 * Get document chunks from backend (for synchronized translation)
 */
export async function getDocumentChunks(documentId: number): Promise<ChunkSyncResponse> {
    return apiFetch<ChunkSyncResponse>(`/api/review/document/${documentId}/chunks`);
}

export interface TranslationSaveItem {
    chunk_tag: string;
    translation: string;
    node_id: number;
}

/**
 * Save translations for multiple chunks
 */
export async function saveTranslations(
    documentId: number, 
    translations: TranslationSaveItem[]
): Promise<{ success: boolean; message: string }> {
    return apiFetch<{ success: boolean; message: string }>(
        `/api/review/document/${documentId}/translations`,
        {
            method: 'POST',
            body: JSON.stringify({ translations }),
        }
    );
}
