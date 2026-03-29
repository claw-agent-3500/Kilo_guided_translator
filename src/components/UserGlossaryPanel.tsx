// User Glossary Panel Component
// Display and manage learned terminology preferences

import { BookOpen, Download, Trash2, Award } from 'lucide-react';
import { getUserGlossary, downloadUserGlossary, clearUserGlossary } from '../services/userGlossaryService';
import type { UserGlossaryEntry } from '../services/userGlossaryService';
import { useState, useEffect } from 'react';
import ConfirmDialog from './ConfirmDialog';

interface UserGlossaryPanelProps {
    onRefresh?: () => void;
}

export default function UserGlossaryPanel({ onRefresh }: UserGlossaryPanelProps) {
    const [glossary, setGlossary] = useState<UserGlossaryEntry[]>([]);
    const [showConfirmClear, setShowConfirmClear] = useState(false);

    useEffect(() => {
        refreshGlossary();
    }, []);

    const refreshGlossary = () => {
        const userGlossary = getUserGlossary();
        setGlossary(userGlossary);
        if (onRefresh) onRefresh();
    };

    const handleDownload = () => {
        downloadUserGlossary();
    };

    const handleClear = () => {
        clearUserGlossary();
        setGlossary([]);
        setShowConfirmClear(false);
    };

    const getConfidenceBadge = (confidence: string) => {
        const colors = {
            high: 'bg-emerald-100 text-emerald-700 border-emerald-300',
            medium: 'bg-amber-100 text-amber-700 border-amber-300',
            low: 'bg-slate-100 text-slate-600 border-slate-300',
        };
        return colors[confidence as keyof typeof colors] || colors.low;
    };

    if (glossary.length === 0) {
        return (
            <div className="bg-white rounded-lg shadow-md p-8 text-center">
                <BookOpen className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <h3 className="text-lg font-semibold text-slate-700 mb-2">No User Glossary Yet</h3>
                <p className="text-sm text-slate-500">
                    Make edits in the refinement interface to build your personal terminology glossary.
                </p>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-lg shadow-md p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-100 rounded-lg">
                        <BookOpen className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                        <h3 className="text-xl font-bold text-slate-800">Your Personal Glossary</h3>
                        <p className="text-sm text-slate-500">{glossary.length} learned term{glossary.length > 1 ? 's' : ''}</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={handleDownload}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium shadow-sm"
                    >
                        <Download className="w-4 h-4" />
                        Export CSV
                    </button>
                    <button
                        onClick={() => setShowConfirmClear(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors text-sm font-medium border border-red-200"
                    >
                        <Trash2 className="w-4 h-4" />
                        Clear
                    </button>
                </div>
            </div>

            {/* Glossary Table */}
            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead>
                        <tr className="border-b-2 border-slate-200">
                            <th className="text-left py-3 px-4 text-xs font-semibold text-slate-600 uppercase">English</th>
                            <th className="text-left py-3 px-4 text-xs font-semibold text-slate-600 uppercase">Original</th>
                            <th className="text-left py-3 px-4 text-xs font-semibold text-slate-600 uppercase">Your Preference</th>
                            <th className="text-center py-3 px-4 text-xs font-semibold text-slate-600 uppercase">Uses</th>
                            <th className="text-center py-3 px-4 text-xs font-semibold text-slate-600 uppercase">Confidence</th>
                        </tr>
                    </thead>
                    <tbody>
                        {glossary.map((entry, index) => (
                            <tr
                                key={index}
                                className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                            >
                                <td className="py-3 px-4 text-sm text-slate-800 font-medium">
                                    {entry.english}
                                </td>
                                <td className="py-3 px-4 text-sm text-slate-500 line-through">
                                    {entry.originalChinese}
                                </td>
                                <td className="py-3 px-4 text-sm text-emerald-600 font-medium">
                                    {entry.preferredChinese}
                                </td>
                                <td className="py-3 px-4 text-center">
                                    <span className="inline-flex items-center px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded">
                                        {entry.frequency}
                                    </span>
                                </td>
                                <td className="py-3 px-4 text-center">
                                    <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border ${getConfidenceBadge(entry.confidence)}`}>
                                        {entry.confidence === 'high' && <Award className="w-3 h-3" />}
                                        {entry.confidence.toUpperCase()}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Confirm Clear Dialog */}
            <ConfirmDialog
                isOpen={showConfirmClear}
                title="Clear User Glossary?"
                message={`This will permanently delete all ${glossary.length} learned terms. This action cannot be undone.`}
                confirmLabel="Clear Glossary"
                variant="danger"
                onConfirm={handleClear}
                onCancel={() => setShowConfirmClear(false)}
            />

            {/* Info Card */}
            <div className="mt-6 p-4 bg-purple-50 rounded-xl border border-purple-100">
                <p className="text-xs text-purple-800 leading-relaxed">
                    <strong>💡 Pro Tip:</strong> Export this glossary and re-import it into Standard Linguist to refine
                    your base terminology for future projects. Your learned preferences will compound over time!
                </p>
            </div>
        </div>
    );
}
