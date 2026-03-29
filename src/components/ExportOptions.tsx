// Export Options Component
import { logger } from '../services/logger';
import { useState } from 'react';
import { Download, FileText, File, Loader2, Sparkles, FileDown, Copy, Check } from 'lucide-react';
import { saveAs } from 'file-saver';
import type { TranslatedChunk } from '../types';
import { reassembleChunks } from '../services/chunkManager';
import PrintExportModal from './PrintExportModal';

interface ExportOptionsProps {
    translatedChunks: TranslatedChunk[];
}

export default function ExportOptions({ translatedChunks }: ExportOptionsProps) {
    if (translatedChunks.length === 0) {
        return null;
    }

    const [isExporting, setIsExporting] = useState(false);
    const [exportProgress, setExportProgress] = useState(0);
    const [showSmartPdfModal, setShowSmartPdfModal] = useState(false);
    const [copiedField, setCopiedField] = useState<string | null>(null);

    const handleCopyToClipboard = async (content: string, field: string) => {
        try {
            await navigator.clipboard.writeText(content);
            setCopiedField(field);
            setTimeout(() => setCopiedField(null), 2000);
        } catch {
            // Fallback
            const ta = document.createElement('textarea');
            ta.value = content;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            setCopiedField(field);
            setTimeout(() => setCopiedField(null), 2000);
        }
    };

    const handleExportPDF = async () => {
        setIsExporting(true);
        setExportProgress(0);

        try {
            // Import the API client function
            const { exportPdf } = await import('../services/apiClient');

            setExportProgress(20);

            // Prepare chunks for export
            const exportChunks = translatedChunks.map((chunk, index) => ({
                id: chunk.id || `chunk_${index}`,
                text: chunk.text || '',
                translation: chunk.translation,
                type: chunk.type as 'heading' | 'paragraph' | 'list' | 'table',
                position: chunk.position ?? index,
            }));

            logger.debug('PDF Export] Sending', exportChunks.length, 'chunks to backend...');
            setExportProgress(40);

            // Call backend to generate PDF
            const pdfBlob = await exportPdf({
                chunks: exportChunks,
                title: 'Technical Translation',
            });

            setExportProgress(80);

            // Download the PDF
            const { saveAs } = await import('file-saver');
            const filename = `translation_${Date.now()}.pdf`;
            saveAs(pdfBlob, filename);

            logger.log('✅ Text-based PDF downloaded:', filename);
            setExportProgress(100);

        } catch (error) {
            console.error("PDF Export failed:", error);
            alert("Failed to export PDF. Please try again.\n\n" + (error instanceof Error ? error.message : String(error)));
        } finally {
            setIsExporting(false);
            setExportProgress(0);
        }
    };

    const handleExportText = (format: 'translation' | 'bilingual') => {
        logger.log('🔍 Export initiated - Format:', format);

        let content = '';
        let filename = '';

        if (format === 'translation') {
            content = reassembleChunks(
                translatedChunks.map(chunk => ({ text: chunk.translation, type: chunk.type }))
            );
            filename = `translation_${Date.now()}.txt`;
        } else {
            content = translatedChunks
                .map((chunk) => {
                    return `[Original]\n${chunk.text}\n\n[Translation]\n${chunk.translation}\n\n${'='.repeat(80)}\n`;
                })
                .join('\n');
            filename = `translation_bilingual_${Date.now()}.txt`;
        }

        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        saveAs(blob, filename);
        logger.log('✅ Download triggered:', filename);
    };

    const handleExportOriginalMD = () => {
        // Reassemble original MinerU markdown from chunk text
        const originalMd = translatedChunks
            .map(chunk => chunk.text)
            .join('\n\n');

        const blob = new Blob([originalMd], { type: 'text/markdown;charset=utf-8' });
        const filename = `original_mineru_${Date.now()}.md`;
        saveAs(blob, filename);
        logger.log('✅ Original MinerU MD downloaded:', filename);
    };

    const handleExportNewTerms = () => {
        // Collect all new terms
        const newTermsMap = new Map<string, { chinese: string; frequency: number; chunks: string[] }>();

        for (const chunk of translatedChunks) {
            for (const term of chunk.newTerms || []) {
                const existing = newTermsMap.get(term.english);
                if (existing) {
                    existing.frequency += term.frequency;
                    existing.chunks.push(...term.chunks);
                } else {
                    newTermsMap.set(term.english, {
                        chinese: term.chinese,
                        frequency: term.frequency,
                        chunks: [...term.chunks]
                    });
                }
            }
        }

        // Convert to CSV
        const csvLines = ['English,Chinese,Frequency,Chunks'];
        for (const [english, data] of newTermsMap.entries()) {
            csvLines.push(`"${english}","${data.chinese}",${data.frequency},"${data.chunks.join(';')}"`);
        }

        const csv = csvLines.join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const filename = `new_terms_${Date.now()}.csv`;
        saveAs(blob, filename);
        logger.log('✅ CSV download triggered:', filename);
    };

    return (
        <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <Download className="w-5 h-5" />
                Export Options
            </h2>

            {/* Copy Translation to Clipboard */}
            <button
                onClick={() => {
                    const content = translatedChunks.map(c => c.translation).join('\n\n');
                    handleCopyToClipboard(content, 'translation');
                }}
                className="w-full mb-4 flex items-center justify-center gap-2 p-3 bg-slate-100 border border-slate-200 rounded-xl hover:bg-slate-200 transition-all font-medium text-sm"
            >
                {copiedField === 'translation' ? (
                    <><Check className="w-4 h-4 text-emerald-600" /> Copied to Clipboard!</>
                ) : (
                    <><Copy className="w-4 h-4" /> Copy Translation to Clipboard</>
                )}
            </button>

            {/* Download Options - Grouped */}
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Download Files</p>
            <div className="grid md:grid-cols-2 gap-3 mb-4">
                {/* PDF Export */}
                <button
                    onClick={handleExportPDF}
                    disabled={isExporting}
                    className="flex items-center justify-between p-4 border border-blue-200 bg-blue-50/50 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-all group disabled:opacity-70 disabled:cursor-wait"
                >
                    <div className="flex items-center gap-3">
                        {isExporting ? (
                            <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                        ) : (
                            <File className="w-5 h-5 text-blue-600" />
                        )}
                        <div className="text-left">
                            <p className="font-medium text-slate-800">
                                {isExporting ? `Generating PDF (${exportProgress}%)` : 'Export as PDF'}
                            </p>
                            <p className="text-xs text-slate-500">
                                {isExporting ? 'Please wait...' : 'Formatted Chinese document'}
                            </p>
                        </div>
                    </div>
                </button>

                {/* New Terms */}
                <button
                    onClick={handleExportNewTerms}
                    className="flex items-center justify-between p-4 border border-emerald-200 bg-emerald-50/50 rounded-lg hover:border-emerald-500 hover:bg-emerald-50 transition-all group"
                >
                    <div className="flex items-center gap-3">
                        <FileText className="w-5 h-5 text-emerald-600" />
                        <div className="text-left">
                            <p className="font-medium text-slate-800">New Terms (CSV)</p>
                            <p className="text-xs text-slate-500">Export discovered terminology</p>
                        </div>
                    </div>
                </button>

                {/* Translation Only */}
                <button
                    onClick={() => handleExportText('translation')}
                    className="flex items-center justify-between p-4 border border-slate-200 rounded-lg hover:border-slate-400 hover:bg-slate-50 transition-all group"
                >
                    <div className="flex items-center gap-3">
                        <FileText className="w-5 h-5 text-slate-600" />
                        <div className="text-left">
                            <p className="font-medium text-slate-800">Plain Text (ZH)</p>
                            <p className="text-xs text-slate-500">Unformatted translation</p>
                        </div>
                    </div>
                </button>

                {/* Bilingual */}
                <button
                    onClick={() => handleExportText('bilingual')}
                    className="flex items-center justify-between p-4 border border-slate-200 rounded-lg hover:border-slate-400 hover:bg-slate-50 transition-all group"
                >
                    <div className="flex items-center gap-3">
                        <FileText className="w-5 h-5 text-slate-600" />
                        <div className="text-left">
                            <p className="font-medium text-slate-800">Bilingual Text (EN/ZH)</p>
                            <p className="text-xs text-slate-500">Comparative side-by-side</p>
                        </div>
                    </div>
                </button>

                {/* Markdown Export (MinerU style) */}
                <button
                    onClick={() => {
                        import('../services/exportToMarkdown').then(mod => {
                            mod.downloadAsMarkdown(translatedChunks, `translation_${Date.now()}`);
                        });
                    }}
                    className="flex items-center justify-between p-4 border border-purple-200 bg-purple-50/50 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition-all group"
                >
                    <div className="flex items-center gap-3">
                        <File className="w-5 h-5 text-purple-600" />
                        <div className="text-left">
                            <p className="font-medium text-slate-800">Markdown (MD)</p>
                            <p className="text-xs text-slate-500">Structured format</p>
                        </div>
                    </div>
                </button>

                {/* Original MinerU Output */}
                <button
                    onClick={handleExportOriginalMD}
                    className="flex items-center justify-between p-4 border border-orange-200 bg-orange-50/50 rounded-lg hover:border-orange-500 hover:bg-orange-50 transition-all group"
                >
                    <div className="flex items-center gap-3">
                        <FileDown className="w-5 h-5 text-orange-600" />
                        <div className="text-left">
                            <p className="font-medium text-slate-800">Original (MinerU MD)</p>
                            <p className="text-xs text-slate-500">Pre-translation source markdown</p>
                        </div>
                    </div>
                </button>
            </div>

            <div className="mt-6 p-4 bg-amber-50 rounded-xl border border-amber-100 flex gap-3">
                <span className="text-lg">💡</span>
                <p className="text-xs text-amber-800 leading-relaxed">
                    <strong>Pro Tip:</strong> Re-import the "New Terms" CSV back into Standard Linguist later to refine your domain glossary.
                    This creates a virtuous cycle of terminology improvement!
                </p>
            </div>

            {/* Smart PDF Export Button - Full Width */}
            <button
                onClick={() => setShowSmartPdfModal(true)}
                className="mt-4 w-full flex items-center justify-center gap-3 p-4 border-2 border-violet-300 bg-gradient-to-r from-violet-50 to-purple-50 rounded-xl hover:border-violet-500 hover:shadow-lg transition-all group"
            >
                <Sparkles className="w-6 h-6 text-violet-600" />
                <div className="text-left">
                    <p className="font-semibold text-violet-800">Smart PDF Export</p>
                    <p className="text-xs text-violet-600">Preview with pagination • Bilingual mode • Advanced layout</p>
                </div>
            </button>

            {/* Smart PDF Modal */}
            <PrintExportModal
                isOpen={showSmartPdfModal}
                onClose={() => setShowSmartPdfModal(false)}
                chunks={translatedChunks}
                onBackendExport={handleExportPDF}
            />
        </div>
    );
}
