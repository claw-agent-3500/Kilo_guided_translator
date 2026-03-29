// Translation Panel Component - Side by side view
import { useState, useMemo } from 'react';
import type { TranslatedChunk, TermMatch } from '../types';
import { Search, X } from 'lucide-react';
import Skeleton from './Skeleton';

interface TranslationPanelProps {
    chunks: TranslatedChunk[];
    onScroll?: (position: number) => void;
    isTranslating?: boolean;
}

export default function TranslationPanel({ chunks, isTranslating = false }: TranslationPanelProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [searchField, setSearchField] = useState<'all' | 'original' | 'translation'>('all');

    const filteredChunks = useMemo(() => {
        if (!searchQuery.trim()) return chunks;
        const q = searchQuery.toLowerCase();
        return chunks.filter(chunk => {
            if (searchField === 'original') return chunk.text.toLowerCase().includes(q);
            if (searchField === 'translation') return chunk.translation.toLowerCase().includes(q);
            return chunk.text.toLowerCase().includes(q) || chunk.translation.toLowerCase().includes(q);
        });
    }, [chunks, searchQuery, searchField]);
    /**
     * Escape HTML special characters
     */
    const escapeHtml = (text: string) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };

    /**
     * Convert markdown images to HTML img tags
     * Handles: ![alt](url) and ![](url) patterns
     */
    const renderMarkdownImages = (text: string): string => {
        // Match markdown image syntax: ![alt text](url)
        const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;

        return text.replace(imageRegex, (_match, alt, url) => {
            // Create a placeholder that won't be escaped
            // Using data attributes for the actual render
            return `__IMG_START__${url}__IMG_ALT__${alt || 'image'}__IMG_END__`;
        });
    };

    /**
     * Convert image placeholders back to actual img tags (after HTML escaping)
     */
    const restoreImages = (text: string): string => {
        const placeholderRegex = /__IMG_START__(.+?)__IMG_ALT__(.+?)__IMG_END__/g;

        return text.replace(placeholderRegex, (_match, url, alt) => {
            return `<img src="${url}" alt="${alt}" class="max-w-full h-auto rounded-lg my-2 border border-slate-200" loading="lazy" />`;
        });
    };

    /**
     * Highlight terms in text and render images
     */
    const highlightTerms = (text: string, matches: TermMatch[], isTranslation: boolean = false) => {
        // First, extract images and replace with placeholders
        const textWithPlaceholders = renderMarkdownImages(text);

        // Then escape HTML (placeholders are safe ASCII)
        const escapedText = escapeHtml(textWithPlaceholders);
        let result = escapedText;

        // Apply term highlighting
        if (matches.length > 0) {
            const termsToHighlight = isTranslation
                ? matches.map(m => ({ term: m.chinese, tooltip: m.english, type: m.source }))
                : matches.map(m => ({ term: m.english, tooltip: m.chinese, type: m.source }));

            const sortedTerms = [...new Set(termsToHighlight)].sort((a, b) => b.term.length - a.term.length);

            for (const item of sortedTerms) {
                const escapedTerm = escapeHtml(item.term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(escapedTerm, 'g');
                const colorClass = item.type === 'glossary' ? 'term-match-glossary' : 'term-match-new';
                result = result.replace(regex, `<mark class="term-match ${colorClass}" title="${escapeHtml(item.tooltip)}">${item.term}</mark>`);
            }
        }

        // Apply search highlighting (on top of term highlighting)
        if (searchQuery.trim()) {
            const q = escapeHtml(searchQuery.trim()).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const searchRegex = new RegExp(`(${q})`, 'gi');
            // Only highlight text content, not inside HTML tags
            result = result.replace(/>([^<]+)</g, (_match, textContent) => {
                const highlighted = textContent.replace(searchRegex, '<mark class="bg-yellow-200 text-yellow-900 rounded px-0.5">$1</mark>');
                return `>${highlighted}<`;
            });
        }

        // Finally, restore images from placeholders
        result = restoreImages(result);

        return result;
    };

    if (chunks.length === 0 && !isTranslating) {
        return (
            <div className="bg-white rounded-lg shadow-md p-6">
                <p className="text-center text-gray-500">
                    Upload a glossary and document to begin translation
                </p>
            </div>
        );
    }

    // Initial Loading State (Before any chunks generated)
    if (chunks.length === 0 && isTranslating) {
        return (
            <div className="bg-white rounded-lg shadow-md overflow-hidden flex flex-col h-[700px]">
                <div className="border-b bg-gray-50 p-4 flex-none grid grid-cols-2 gap-6">
                    <h3 className="font-semibold text-gray-700">Original (English)</h3>
                    <h3 className="font-semibold text-gray-700">Translation (Chinese)</h3>
                </div>
                <div className="flex-grow overflow-y-auto p-6 bg-slate-50/30 space-y-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col md:grid md:grid-cols-2">
                            <div className="p-4 border-r border-slate-100 bg-slate-50/50">
                                <Skeleton className="w-16 h-3 mb-4" />
                                <Skeleton.Text lines={3} />
                            </div>
                            <div className="p-4">
                                <Skeleton className="w-16 h-3 mb-4 ml-auto" />
                                <Skeleton.Text lines={3} />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-lg shadow-md overflow-hidden flex flex-col h-[700px]">
            <div className="border-b bg-gray-50 p-4 flex-none">
                <div className="grid grid-cols-2 gap-6 mb-3">
                    <h3 className="font-semibold text-gray-700">Original (English)</h3>
                    <h3 className="font-semibold text-gray-700">Translation (Chinese)</h3>
                </div>
                {/* Search bar */}
                <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search chunks..."
                            className="w-full pl-9 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                    <select
                        value={searchField}
                        onChange={(e) => setSearchField(e.target.value as typeof searchField)}
                        className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                        <option value="all">All</option>
                        <option value="original">Original</option>
                        <option value="translation">Translation</option>
                    </select>
                    {searchQuery && (
                        <span className="text-xs text-slate-500 whitespace-nowrap">
                            {filteredChunks.length} of {chunks.length} chunks
                        </span>
                    )}
                    {searchQuery && filteredChunks.length > 0 && (
                        <span className="text-xs text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                            {filteredChunks.reduce((sum, c) => {
                                const q = searchQuery.toLowerCase();
                                const inOriginal = (c.text.toLowerCase().match(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
                                const inTranslation = (c.translation.toLowerCase().match(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
                                return sum + inOriginal + inTranslation;
                            }, 0)} matches
                        </span>
                    )}
                </div>
            </div>

            <div className="flex-grow overflow-y-auto p-6 bg-slate-50/30">
                <div className="space-y-4">
                    {filteredChunks.map((chunk) => (
                        <div key={chunk.id} className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col md:grid md:grid-cols-2 items-stretch">
                            {/* Original Text */}
                            <div className="p-4 border-b md:border-b-0 md:border-r border-slate-100 bg-slate-50/50 h-full">
                                <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-2 font-mono">Chunk {chunk.position + 1}</div>
                                <div
                                    className={`doc-content ${chunk.type === 'heading' ? 'font-bold text-lg' : ''}`}
                                    dangerouslySetInnerHTML={{
                                        __html: highlightTerms(chunk.text, chunk.matchedTerms, false)
                                    }}
                                />
                            </div>

                            {/* Translated Text */}
                            <div className="p-4 bg-white h-full">
                                <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-2 font-mono md:text-right">段落 {chunk.position + 1}</div>
                                <div
                                    className={`doc-content doc-content-zh ${chunk.type === 'heading' ? 'font-bold text-lg' : ''}`}
                                    dangerouslySetInnerHTML={{
                                        __html: highlightTerms(chunk.translation, chunk.matchedTerms, true)
                                    }}
                                />
                            </div>
                        </div>
                    ))}

                    {/* Skeleton Loader - Appears at bottom when translating */}
                    {isTranslating && (
                        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col md:grid md:grid-cols-2 animate-pulse">
                            <div className="p-4 border-r border-slate-100 bg-slate-50/50">
                                <div className="h-3 w-16 bg-slate-200 rounded mb-4"></div>
                                <div className="h-4 w-full bg-slate-200 rounded mb-2"></div>
                                <div className="h-4 w-3/4 bg-slate-200 rounded mb-2"></div>
                                <div className="h-4 w-5/6 bg-slate-200 rounded"></div>
                            </div>
                            <div className="p-4 bg-white">
                                <div className="flex justify-end mb-4">
                                    <div className="h-3 w-16 bg-slate-200 rounded"></div>
                                </div>
                                <div className="h-4 w-full bg-slate-200 rounded mb-2"></div>
                                <div className="h-4 w-5/6 bg-slate-200 rounded mb-2"></div>
                                <div className="h-4 w-4/6 bg-slate-200 rounded"></div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Legend */}
            <div className="border-t bg-gray-50 p-4 flex gap-6 text-sm flex-none">
                <div className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded-full bg-emerald-400"></span>
                    <span className="text-slate-600 font-medium">Glossary Matched</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded-full bg-sky-400"></span>
                    <span className="text-slate-600 font-medium">Auto-Translated</span>
                </div>
                <div className="ml-auto text-xs text-slate-400 italic">
                    Hover over highlighted terms to see the source/translation
                </div>
            </div>
        </div>
    );
}
