// Document Parser Service
// Extract text from PDF documents using PDF.js or MinerU backend

import * as pdfjsLib from 'pdfjs-dist';
import type { DocumentStructure } from '../types';

// Set up PDF.js worker using unpkg for better reliability
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

/**
 * Page extraction result for streaming (kept for interface compatibility)
 */
export interface PageExtractionResult {
    pageNum: number;
    totalPages: number;
    content: string;
    complexity: 'simple' | 'complex' | 'table';
    confidence?: number;
}

/**
 * Layout analysis thresholds
 */
interface LayoutThresholds {
    sameLine: number;
    newLine: number;
    paragraphBreak: number;
}

/**
 * Analyze document page to determine dynamic thresholds
 */
function analyzeDocumentLayout(textContent: any): LayoutThresholds {
    const verticalGaps: number[] = [];
    let lastY = -1;
    const items = textContent.items as any[];

    for (const item of items) {
        if (!item.str.trim()) continue;
        const y = item.transform[5];
        if (lastY !== -1) {
            const gap = Math.abs(y - lastY);
            if (gap > 0.1 && gap < 500) {
                verticalGaps.push(gap);
            }
        }
        lastY = y;
    }

    if (verticalGaps.length < 5) {
        return { sameLine: 3, newLine: 15, paragraphBreak: 30 };
    }

    verticalGaps.sort((a, b) => a - b);
    const p20 = verticalGaps[Math.floor(verticalGaps.length * 0.2)];
    const p50 = verticalGaps[Math.floor(verticalGaps.length * 0.5)];
    const p80 = verticalGaps[Math.floor(verticalGaps.length * 0.8)];

    return {
        sameLine: Math.max(p20 * 0.8, 2),
        newLine: Math.max(p50 * 1.5, 10),
        paragraphBreak: Math.max(p80 * 1.2, 25)
    };
}

/**
 * Calculate the dominant left margin to detect indentation
 */
function calculateLeftMargin(textContent: any): number {
    const items = textContent.items as any[];
    const xPositions: number[] = [];

    for (const item of items) {
        if (!item.str.trim()) continue;
        xPositions.push(item.transform[4]);
    }

    if (xPositions.length === 0) return 0;

    const counts = new Map<number, number>();
    let maxCount = 0;
    let dominantX = xPositions[0];

    for (const x of xPositions) {
        const bin = Math.round(x / 5) * 5;
        const count = (counts.get(bin) || 0) + 1;
        counts.set(bin, count);

        if (count > maxCount) {
            maxCount = count;
            dominantX = bin;
        } else if (count === maxCount && bin < dominantX) {
            dominantX = bin;
        }
    }

    return dominantX;
}

/**
 * Extract standard title/code from text
 */
export function extractStandardTitle(text: string, filename: string): string {
    const headerText = text.substring(0, 1000);
    const standardRegex = /\b([A-Z]{2,4})\s+(\d{3,6}(?:[-:]\d+)*)/;
    const match = headerText.match(standardRegex);

    if (match) {
        return `${match[1]} ${match[2]}`;
    }
    return filename.replace(/\.[^/.]+$/, "");
}

/**
 * Extract full text from PDF file (simple extraction)
 */
export async function extractText(file: File): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
            .map((item: any) => item.str)
            .join(' ');
        fullText += pageText + '\n\n';
    }

    return fullText;
}

/**
 * Extract structured content from Markdown file
 */
export async function extractMarkdown(file: File): Promise<DocumentStructure> {
    const text = await file.text();
    const language = detectLanguage(text);
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

    return {
        text: text.trim(),
        pages: Math.ceil(wordCount / 500) || 1,
        wordCount,
        language
    };
}

/**
 * Extract text from a single PDF page using legacy rule-based parser
 * Used as fallback when MinerU is not available
 */
async function extractTextLegacy(page: any): Promise<string> {
    const textContent = await page.getTextContent();
    const thresholds = analyzeDocumentLayout(textContent);
    const leftMargin = calculateLeftMargin(textContent);

    let lastY = -1;
    let lastX = 0;
    let lastWidth = 0;
    let currentLine = '';
    let currentIndent = 0;
    const lines: string[] = [];
    const rawItems = textContent.items as any[];

    for (const item of rawItems) {
        const text = item.str;
        if (!text.trim()) continue;

        const y = item.transform[5];
        const x = item.transform[4];
        const height = item.height || 12;
        const isHeading = height > 12;
        const relativeX = Math.max(0, x - leftMargin);
        const indentLevel = Math.floor(relativeX / 20);

        if (lastY === -1) {
            currentLine = text;
            currentIndent = indentLevel;
            lastY = y;
            lastX = x;
            lastWidth = height > 0 ? (item.width || text.length * 6) : 0;
        } else {
            const verticalGap = Math.abs(y - lastY);

            if (verticalGap < thresholds.sameLine) {
                const textWidth = item.width || (text.length * 6);
                const currentX = item.transform[4];
                const gapX = currentX - (lastX + lastWidth);

                if (currentLine && !currentLine.endsWith('-') && !text.startsWith(' ')) {
                    if (gapX > 30) {
                        currentLine += ' | ' + text;
                    } else {
                        currentLine += ' ' + text;
                    }
                } else if (currentLine.endsWith('-')) {
                    if (text[0] && text[0] === text[0].toLowerCase()) {
                        currentLine = currentLine.slice(0, -1) + text;
                    } else {
                        currentLine += text;
                    }
                } else {
                    currentLine += text;
                }

                lastX = currentX;
                lastWidth = textWidth;
            } else {
                if (currentLine.trim()) {
                    const indentString = currentIndent > 0 ? '  '.repeat(currentIndent) : '';
                    const formattedLine = isHeading ? `## ${currentLine}` : `${indentString}${currentLine}`;
                    lines.push(formattedLine);
                }
                if (verticalGap > thresholds.paragraphBreak) {
                    lines.push('');
                }
                currentLine = text;
                currentIndent = indentLevel;
                lastY = y;
                lastX = x;
                lastWidth = item.width || (text.length * 6);
            }
        }
    }

    if (currentLine.trim()) {
        const indentString = currentIndent > 0 ? '  '.repeat(currentIndent) : '';
        lines.push(indentString + currentLine);
    }

    return lines.join('\n');
}

/**
 * Extract structured content from File (PDF or Markdown)
 * Primary path: Uses MinerU via backend API
 * Fallback: Local PDF.js extraction (for simple documents)
 */
export async function extractStructuredContent(
    file: File,
    _apiKeys?: string | string[],  // DEPRECATED: unused
    progressCallback?: (current: number, total: number) => void,
    _useMinerU: boolean = true,    // DEPRECATED: always uses MinerU
    _useBackend: boolean = true    // DEPRECATED: always uses backend
): Promise<DocumentStructure> {
    // Handle Markdown files — route through backend so skeleton is stored in DB
    if (file.name.endsWith('.md') || file.type === 'text/markdown') {
        const { parseMarkdown } = await import('./apiClient');
        if (progressCallback) progressCallback(0, 1);

        try {
            const result = await parseMarkdown(file);
            if (!result.success || !result.document) {
                throw new Error(result.error || 'Markdown parsing failed');
            }
            if (progressCallback) progressCallback(1, 1);
            return {
                text: result.document.text,
                pages: result.document.pages,
                wordCount: result.document.word_count,
                language: result.document.language,
                backendDocId: result.doc_id ?? undefined,
            };
        } catch (error) {
            // Fallback: parse client-side (no skeleton stored)
            console.warn('[Parser] Backend markdown parsing failed, falling back to client-side:', error);
            if (progressCallback) progressCallback(1, 1);
            return extractMarkdown(file);
        }
    }

    // Handle PDF files via backend MinerU API
    if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        const { parsePdf } = await import('./apiClient');

        console.log('[Parser] Using backend API for PDF extraction...');
        if (progressCallback) progressCallback(0, 100);

        try {
            const result = await parsePdf(file, true);

            if (!result.success || !result.document) {
                const errorMsg = result.error || 'Unknown error';
                console.error('[Parser] Backend parsing failed:', errorMsg);
                throw new Error(`PDF parsing failed: ${errorMsg}`);
            }

            if (progressCallback) progressCallback(100, 100);

            return {
                text: result.document.text,
                pages: result.document.pages,
                wordCount: result.document.word_count,
                language: result.document.language,
                backendDocId: result.doc_id ?? undefined,
            };
        } catch (error) {
            console.error('[Parser] Backend API error:', error);
            throw error;
        }
    }

    throw new Error(`Unsupported file type: ${file.type || file.name}`);
}

/**
 * Detect document language
 */
export function detectLanguage(text: string): 'en' | 'zh' | 'unknown' {
    const sample = text.slice(0, 1000);
    const chineseChars = (sample.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = (sample.match(/[a-zA-Z]+/g) || []).length;

    if (chineseChars > englishWords) {
        return 'zh';
    } else if (englishWords > chineseChars * 2) {
        return 'en';
    }
    return 'unknown';
}

/**
 * Estimate reading time in minutes
 */
export function estimateReadingTime(wordCount: number): number {
    const wordsPerMinute = 200;
    return Math.ceil(wordCount / wordsPerMinute);
}

// Keep extractTextLegacy available for potential future use
export { extractTextLegacy };
