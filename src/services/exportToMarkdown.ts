import { saveAs } from 'file-saver';
import { logger } from './logger';
import type { Chunk, TranslatedChunk } from '../types';

/**
 * Convert chunks to a single Markdown string
 */
export function convertChunksToMarkdown(chunks: Chunk[] | TranslatedChunk[], isTranslation: boolean = false): string {
    return chunks.map(chunk => {
        let text = isTranslation && 'translation' in chunk ? (chunk as TranslatedChunk).translation : chunk.text;

        switch (chunk.type) {
            case 'heading':
                // Check if text already has markdown heading
                if (!/^#{1,6}\s/.test(text)) {
                    const level = chunk.metadata?.level || 2;
                    text = `${'#'.repeat(level)} ${text}`;
                }
                return `${text}\n\n`;

            case 'list':
                // Ensure list items are formatted
                return text.split('\n')
                    .map(line => {
                        const trimmed = line.trim();
                        // If line isn't already a list item, make it one if it looks like one, or just indent
                        if (/^[\-\*\u2022]/.test(trimmed) || /^\d+[\.\)]/.test(trimmed)) {
                            return line;
                        }
                        return `- ${line}`;
                    })
                    .join('\n') + '\n\n';

            case 'table':
                // Pass table through (assuming Gemini preserved md table or HTML)
                return `${text}\n\n`;

            case 'paragraph':
            default:
                return `${text}\n\n`;
        }
    }).join('');
}

/**
 * Generate a Blob URL for the markdown content (for manual download strategy)
 */
export function createMarkdownBlobUrl(chunks: Chunk[] | TranslatedChunk[]): string {
    const markdown = convertChunksToMarkdown(chunks, true);
    const blob = new Blob([markdown], { type: 'application/octet-stream' });
    return URL.createObjectURL(blob);
}

/**
 * Trigger download of Markdown file using FileSaver.js (ROBUST)
 */
export function downloadAsMarkdown(chunks: Chunk[] | TranslatedChunk[], filename: string): void {
    const markdown = convertChunksToMarkdown(chunks, true);
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    saveAs(blob, `${filename}.md`);
    logger.log(`Markdown export initiated: ${filename}.md`);
}
