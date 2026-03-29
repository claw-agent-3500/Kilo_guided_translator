// Document Upload Component
import { logger } from '../services/logger';
import { useState, useRef } from 'react';
import { FileUp, File, Check, AlertCircle, Loader2, HardDrive } from 'lucide-react';
import type { DocumentStructure } from '../types';
import { extractStructuredContent } from '../services/documentParser';

interface ApiKeyConfig {
    key: string;
    isPaid: boolean;
}

interface DocumentUploadProps {
    onDocumentLoaded: (doc: DocumentStructure) => void;
    currentDocument: DocumentStructure | null;
    apiKeys?: string[] | ApiKeyConfig[];
}

export default function DocumentUpload({ onDocumentLoaded, currentDocument, apiKeys }: DocumentUploadProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState({ current: 0, total: 0 });
    const [error, setError] = useState<string | null>(null);
    const [useMinerU, setUseMinerU] = useState(true);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => {
        setIsDragging(false);
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        const file = e.dataTransfer.files[0];
        if (file) {
            await processFile(file);
        }
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            await processFile(file);
        }
    };

    const processFile = async (file: File) => {
        if (!file.name.endsWith('.pdf') && !file.name.endsWith('.md')) {
            setError('Please upload a PDF or Markdown file');
            return;
        }

        if (file.size > 50 * 1024 * 1024) {
            setError('File size must be less than 50MB');
            return;
        }

        setIsProcessing(true);
        setError(null);
        setProgress({ current: 0, total: 0 });

        try {
            // NOTE: Don't pass API keys to extractStructuredContent
            // All Gemini API calls should go through the backend
            // The backend handles key management and rate limiting
            logger.debug('DocumentUpload] Starting document extraction via backend...');

            const doc = await extractStructuredContent(
                file,
                undefined,  // No direct API keys - backend handles them
                (current, total) => {
                    setProgress({ current, total });
                },
                useMinerU,
                true  // useBackend = true
            );

            if (doc.language !== 'en') {
                setError(`Warning: Document appears to be in ${doc.language === 'zh' ? 'Chinese' : 'an unknown language'}. Please upload an English document.`);
            }

            onDocumentLoaded(doc);
        } catch (error) {
            setError(error instanceof Error ? error.message : 'Failed to process document');
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <File className="w-5 h-5" />
                Upload Document
            </h2>

            {/* Upload Area or Processing State */}
            {isProcessing ? (
                <div className="border-2 border-blue-100 bg-blue-50/50 rounded-lg p-12 text-center flex flex-col items-center justify-center min-h-[300px]">
                    <div className="relative mb-6">
                        <div className="absolute inset-0 bg-blue-200 rounded-full animate-ping opacity-25"></div>
                        <div className="relative bg-white p-4 rounded-full shadow-sm border border-blue-100">
                            <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                        </div>
                    </div>

                    <h3 className="text-lg font-semibold text-slate-800 mb-2">
                        {progress.total > 0 ? 'Analyzing Document' : 'Processing File'}
                    </h3>

                    {/* AI Vision Active Indicator */}
                    {apiKeys && apiKeys.length > 0 && apiKeys[0] && (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-500 to-blue-500 text-white text-xs font-medium rounded-full mb-3 animate-pulse">
                            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M10 2a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 2zM10 15a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 15zM2 10a.75.75 0 01.75-.75h1.5a.75.75 0 010 1.5h-1.5A.75.75 0 012 10zM15.75 10a.75.75 0 01.75-.75h1.5a.75.75 0 010 1.5h-1.5a.75.75 0 01-.75-.75zM4.343 4.343a.75.75 0 011.06 0l1.06 1.06a.75.75 0 11-1.06 1.06l-1.06-1.06a.75.75 0 010-1.06zM14.596 14.596a.75.75 0 011.06 0l1.06 1.06a.75.75 0 11-1.06 1.06l-1.06-1.06a.75.75 0 010-1.06zM4.343 15.657a.75.75 0 010-1.06l1.06-1.06a.75.75 0 111.06 1.06l-1.06 1.06a.75.75 0 01-1.06 0zM14.596 5.404a.75.75 0 010-1.06l1.06-1.06a.75.75 0 111.06 1.06l-1.06 1.06a.75.75 0 01-1.06 0z" />
                            </svg>
                            AI Vision Active {apiKeys.length > 1 && `(${apiKeys.length} keys)`}
                        </div>
                    )}

                    <p className="text-slate-600 mb-6 max-w-xs mx-auto">
                        {progress.total > 0
                            ? `Extracting text from page ${progress.current} of ${progress.total}...`
                            : 'Please wait while we prepare your document structure...'}
                    </p>

                    {progress.total > 0 && (
                        <div className="w-full max-w-md bg-white rounded-full h-3 border border-blue-100 overflow-hidden">
                            <div
                                className="bg-blue-600 h-full rounded-full transition-all duration-300 ease-out"
                                style={{ width: `${(progress.current / progress.total) * 100}%` }}
                            ></div>
                        </div>
                    )}
                </div>
            ) : (
                <div
                    className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors min-h-[300px] flex flex-col items-center justify-center ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
                        }`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    role="button"
                    aria-label="Drop zone for document upload"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
                >
                    <FileUp className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                    <p className="text-gray-600 mb-2">
                        Drag PDF or Markdown file here or{' '}
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="text-blue-600 hover:underline font-medium"
                        >
                            browse
                        </button>
                    </p>
                    <p className="text-sm text-gray-500 flex items-center gap-2 justify-center">
                        <HardDrive className="w-3.5 h-3.5" /> Maximum file size: 50MB
                    </p>

                    {/* MinerU Toggle */}
                    <label className="mt-4 flex items-center gap-2 cursor-pointer bg-gray-50 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors">
                        <input
                            type="checkbox"
                            checked={useMinerU}
                            onChange={(e) => setUseMinerU(e.target.checked)}
                            className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700">
                            Use MinerU <span className="text-gray-500">(Recommended for complex PDFs)</span>
                        </span>
                    </label>

                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf,.md"
                        onChange={handleFileSelect}
                        className="hidden"
                    />
                </div>
            )}

            {/* Error Message */}
            {error && (
                <div className="mt-4 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <p className="text-red-800 text-sm">{error}</p>
                </div>
            )}

            {/* Document Summary */}
            {currentDocument && (
                <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-start gap-2">
                        <Check className="w-5 h-5 text-blue-600 mt-0.5" />
                        <div>
                            <p className="text-blue-800 font-medium">Document Loaded</p>
                            <div className="text-blue-700 text-sm mt-1 space-y-1">
                                <p>📄 {currentDocument.pages} pages</p>
                                <p>📝 ~{currentDocument.wordCount.toLocaleString()} words</p>
                                <p>🌐 Language: {currentDocument.language === 'en' ? 'English' : currentDocument.language === 'zh' ? 'Chinese' : 'Unknown'}</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
