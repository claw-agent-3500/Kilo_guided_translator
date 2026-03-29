/**
 * Auto-Save Service
 * Saves translation state to localStorage at fixed intervals to prevent data loss.
 */

import { logger } from './logger';

const STORAGE_KEY = 'guided_translator_state';
const AUTO_SAVE_INTERVAL = 30000; // 30 seconds

export interface SavedState {
    version: number;
    savedAt: string;
    document?: {
        filename: string;
        markdown: string;
        wordCount: number;
        pages: number;
    };
    translations: Record<string, string>;  // chunkId -> translation
    userEdits: Record<string, { text: string; editedAt: string }>;
    progress: {
        currentPage: number;
        completedChunks: number;
        totalChunks: number;
    };
}

let autoSaveInterval: ReturnType<typeof setInterval> | null = null;
let isDirty = false;

/**
 * Save state to localStorage
 */
export function saveState(state: Partial<SavedState>): void {
    try {
        const existingState = loadState();
        const newState: SavedState = {
            version: 1,
            savedAt: new Date().toISOString(),
            translations: {},
            userEdits: {},
            progress: { currentPage: 0, completedChunks: 0, totalChunks: 0 },
            ...existingState,
            ...state,
        };

        localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
        isDirty = false;
        logger.debug('AutoSave] State saved at', newState.savedAt);
    } catch (error) {
        console.error('[AutoSave] Failed to save state:', error);
    }
}

/**
 * Load state from localStorage
 */
export function loadState(): SavedState | null {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return null;

        const state = JSON.parse(stored) as SavedState;
        logger.debug('AutoSave] State loaded from', state.savedAt);
        return state;
    } catch (error) {
        console.error('[AutoSave] Failed to load state:', error);
        return null;
    }
}

/**
 * Check if there's a saved state available
 */
export function hasSavedState(): boolean {
    return localStorage.getItem(STORAGE_KEY) !== null;
}

/**
 * Clear saved state
 */
export function clearState(): void {
    try {
        localStorage.removeItem(STORAGE_KEY);
        logger.debug('AutoSave] State cleared');
    } catch (error) {
        console.error('[AutoSave] Failed to clear state:', error);
    }
}

/**
 * Mark state as dirty (needs saving)
 */
export function markDirty(): void {
    isDirty = true;
}

/**
 * Check if state needs saving
 */
export function needsSave(): boolean {
    return isDirty;
}

/**
 * Start auto-save timer
 */
export function startAutoSave(getStateCallback: () => Partial<SavedState>): void {
    if (autoSaveInterval) {
        clearInterval(autoSaveInterval);
    }

    autoSaveInterval = setInterval(() => {
        if (isDirty) {
            const state = getStateCallback();
            saveState(state);
        }
    }, AUTO_SAVE_INTERVAL);

    logger.debug('AutoSave] Started with interval', AUTO_SAVE_INTERVAL, 'ms');
}

/**
 * Stop auto-save timer
 */
export function stopAutoSave(): void {
    if (autoSaveInterval) {
        clearInterval(autoSaveInterval);
        autoSaveInterval = null;
        logger.debug('AutoSave] Stopped');
    }
}

/**
 * Get time since last save
 */
export function getTimeSinceLastSave(): string | null {
    const state = loadState();
    if (!state?.savedAt) return null;

    const savedAt = new Date(state.savedAt);
    const now = new Date();
    const diffSeconds = Math.floor((now.getTime() - savedAt.getTime()) / 1000);

    if (diffSeconds < 60) return `${diffSeconds}s ago`;
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
    return `${Math.floor(diffSeconds / 3600)}h ago`;
}

/**
 * Save document data (MinerU output)
 */
export function saveDocument(doc: { filename: string; markdown: string; wordCount: number; pages: number }): void {
    const state = loadState() || {} as SavedState;
    state.document = doc;
    saveState(state);
}

/**
 * Save translation for a specific chunk
 */
export function saveTranslation(chunkId: string, translation: string): void {
    markDirty();
    const state = loadState() || { translations: {} } as SavedState;
    state.translations = state.translations || {};
    state.translations[chunkId] = translation;
    // Don't save immediately - let auto-save handle it
}

/**
 * Save user edit for a specific chunk
 */
export function saveUserEdit(chunkId: string, text: string): void {
    markDirty();
    const state = loadState() || { userEdits: {} } as SavedState;
    state.userEdits = state.userEdits || {};
    state.userEdits[chunkId] = { text, editedAt: new Date().toISOString() };
    // Don't save immediately - let auto-save handle it
}

/**
 * Save progress state
 */
export function saveProgress(progress: { currentPage: number; completedChunks: number; totalChunks: number }): void {
    markDirty();
    const state = loadState() || {} as SavedState;
    state.progress = progress;
    // Don't save immediately - let auto-save handle it
}
