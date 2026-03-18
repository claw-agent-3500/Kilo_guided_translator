// Core types for Guided Translator

export interface GlossaryEntry {
    english: string;
    chinese: string;
    source?: string; // Original document name
}

export interface TermIndex {
    [key: string]: GlossaryEntry;
}

export interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
}
export interface Project {
    id: string; // UUID or generated ID
    standardTitle: string; // e.g., "EN 13001-3-1"
    lastModified: number;
    status: 'parsing' | 'translating' | 'editing' | 'completed';
    totalChunks: number;
    translatedChunks: number;
    tokenUsage?: TokenUsage;
}

export interface ChunkData {
    projectId: string;
    chunkId: string;
    position: number;
    originalText: string;
    originalType: Chunk['type'];
    initialTranslation: string;
    currentTranslation: string;
    matchedTerms: TermMatch[];
}

export interface Chunk {
    id: string;
    text: string;
    position: number;
    type: 'heading' | 'paragraph' | 'list' | 'table';
    metadata?: {
        heading?: string;
        level?: number;
        clauseNumber?: string; // e.g., "5.2.1", "A.1"
    };
}

export interface TranslatedChunk extends Chunk {
    translation: string;
    matchedTerms: TermMatch[];
    newTerms: NewTerm[];
    tokenUsage?: TokenUsage;
}

export interface TermMatch {
    english: string;
    chinese: string;
    positions: number[]; // Character indices in chunk
    source: 'glossary' | 'new';
}

export interface NewTerm {
    english: string;
    chinese: string;
    frequency: number;
    chunks: string[]; // Chunk IDs where term appears
}

export interface DocumentStructure {
    text: string;
    pages: number;
    wordCount: number;
    language: 'en' | 'zh' | 'unknown';
    /** Backend DB document ID — present when parsed via the backend API. Used for Markdown export. */
    backendDocId?: number;
}

export interface TranslationProgress {
    current: number;
    total: number;
    percentage: number;
    estimatedTimeRemaining: number;
    glossaryCoverage: {
        matched: number;
        total: number;
    };
}

export interface ValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}

export type AppStatus = 'idle' | 'uploading' | 'processing' | 'translating' | 'complete' | 'error';

export interface AppState {
    glossary: GlossaryEntry[] | null;
    document: DocumentStructure | null;
    chunks: Chunk[];
    translatedChunks: TranslatedChunk[];
    progress: TranslationProgress;
    status: AppStatus;
    error: string | null;
}
