// Glossary Upload Component
import { useState, useRef } from 'react';
import { Upload, FileText, Check, AlertCircle, X } from 'lucide-react';
import type { GlossaryEntry, ValidationResult } from '../types';
import { parseCSV, validateGlossary, getGlossaryStats } from '../services/glossaryParser';

interface GlossaryUploadProps {
    onGlossaryLoaded: (entries: GlossaryEntry[]) => void;
    currentGlossary: GlossaryEntry[] | null;
}

export default function GlossaryUpload({ onGlossaryLoaded, currentGlossary }: GlossaryUploadProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [validation, setValidation] = useState<ValidationResult | null>(null);
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
        if (!file.name.endsWith('.csv')) {
            setValidation({
                isValid: false,
                errors: ['Please upload a CSV file'],
                warnings: []
            });
            return;
        }

        setIsProcessing(true);
        setValidation(null);

        try {
            const entries = await parseCSV(file);
            const validationResult = validateGlossary(entries);

            setValidation(validationResult);

            if (validationResult.isValid) {
                onGlossaryLoaded(entries);
            }
        } catch (error) {
            setValidation({
                isValid: false,
                errors: [error instanceof Error ? error.message : 'Failed to parse CSV'],
                warnings: []
            });
        } finally {
            setIsProcessing(false);
        }
    };

    const handleClear = () => {
        onGlossaryLoaded([]);
        setValidation(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const stats = currentGlossary ? getGlossaryStats(currentGlossary) : null;

    return (
        <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Import Glossary
            </h2>

            {/* Upload Area */}
            <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
                    }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                role="button"
                aria-label="Drop zone for glossary CSV upload"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
            >
                <Upload className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p className="text-gray-600 mb-2">
                    Drag CSV file here or{' '}
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="text-blue-600 hover:underline font-medium"
                    >
                        browse
                    </button>
                </p>
                <p className="text-sm text-gray-500">CSV format: English, Chinese, Source (optional)</p>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleFileSelect}
                    className="hidden"
                />
            </div>

            {/* Processing State */}
            {isProcessing && (
                <div className="mt-4 text-center text-gray-600">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
                    Processing glossary...
                </div>
            )}

            {/* Validation Messages */}
            {validation && (
                <div className="mt-4 space-y-2">
                    {validation.errors.map((error, i) => (
                        <div key={i} className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                            <p className="text-red-800 text-sm">{error}</p>
                        </div>
                    ))}
                    {validation.warnings.map((warning, i) => (
                        <div key={i} className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                            <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                            <p className="text-yellow-800 text-sm">{warning}</p>
                        </div>
                    ))}
                </div>
            )}

            {/* Loaded Glossary Summary */}
            {currentGlossary && currentGlossary.length > 0 && (
                <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-start justify-between">
                        <div className="flex items-start gap-2">
                            <Check className="w-5 h-5 text-green-600 mt-0.5" />
                            <div>
                                <p className="text-green-800 font-medium">Glossary Loaded</p>
                                <p className="text-green-700 text-sm mt-1">
                                    {stats?.totalTerms} terms loaded | {stats?.uniqueTerms} unique
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={handleClear}
                            className="text-green-600 hover:text-green-800"
                            title="Clear glossary"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Preview */}
                    <div className="mt-4 overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead className="border-b border-green-300">
                                <tr>
                                    <th className="text-left py-2 px-3 text-green-800">English</th>
                                    <th className="text-left py-2 px-3 text-green-800">Chinese</th>
                                </tr>
                            </thead>
                            <tbody>
                                {currentGlossary.slice(0, 5).map((entry, i) => (
                                    <tr key={i} className="border-b border-green-200">
                                        <td className="py-2 px-3 text-green-900">{entry.english}</td>
                                        <td className="py-2 px-3 text-green-900">{entry.chinese}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {currentGlossary.length > 5 && (
                            <p className="text-xs text-green-600 mt-2 text-center">
                                Showing 5 of {currentGlossary.length} terms
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
