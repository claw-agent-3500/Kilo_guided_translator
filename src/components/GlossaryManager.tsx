import { useState, useEffect, useCallback } from 'react';
import {
    Book, Plus, Trash2, Upload, Search, X, Check, AlertCircle, Edit2, Filter, RefreshCw
} from 'lucide-react';
import type {
    GlossaryTerm, GlossaryUploadResult
} from '../services/apiClient';
import {
    listGlossary, listGlossaryCategories, createGlossaryTerm,
    updateGlossaryTerm, deleteGlossaryTerm, uploadGlossary, clearGlossary
} from '../services/apiClient';
import ConfirmDialog from './ConfirmDialog';

interface GlossaryManagerProps {
    onTermsUpdated?: () => void;
}

export default function GlossaryManager({ onTermsUpdated }: GlossaryManagerProps) {
    const [terms, setTerms] = useState<GlossaryTerm[]>([]);
    const [categories, setCategories] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('');

    const [showAddForm, setShowAddForm] = useState(false);
    const [editingTerm, setEditingTerm] = useState<GlossaryTerm | null>(null);
    const [formData, setFormData] = useState<GlossaryTerm>({ english: '', chinese: '', notes: '', category: '' });

    const [uploadResult, setUploadResult] = useState<GlossaryUploadResult | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
    const [showClearAll, setShowClearAll] = useState(false);

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [termsData, categoriesData] = await Promise.all([
                listGlossary(selectedCategory || undefined, searchQuery || undefined),
                listGlossaryCategories()
            ]);
            setTerms(termsData);
            setCategories(categoriesData);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load glossary');
        } finally {
            setLoading(false);
        }
    }, [selectedCategory, searchQuery]);

    useEffect(() => { loadData(); }, [loadData]);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setLoading(true);
        setError(null);
        setUploadResult(null);
        try {
            const result = await uploadGlossary(file);
            setUploadResult(result);
            await loadData();
            onTermsUpdated?.();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Upload failed');
        } finally {
            setLoading(false);
            e.target.value = '';
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.english.trim() || !formData.chinese.trim()) return;
        setLoading(true);
        setError(null);
        try {
            if (editingTerm?.id) {
                await updateGlossaryTerm(editingTerm.id, formData);
            } else {
                await createGlossaryTerm(formData);
            }
            setFormData({ english: '', chinese: '', notes: '', category: '' });
            setEditingTerm(null);
            setShowAddForm(false);
            await loadData();
            onTermsUpdated?.();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Operation failed');
        } finally {
            setLoading(false);
        }
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        setLoading(true);
        try {
            await deleteGlossaryTerm(deleteTarget);
            await loadData();
            onTermsUpdated?.();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Delete failed');
        } finally {
            setLoading(false);
            setDeleteTarget(null);
        }
    };

    const confirmClearAll = async () => {
        setLoading(true);
        try {
            await clearGlossary();
            await loadData();
            onTermsUpdated?.();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Clear failed');
        } finally {
            setLoading(false);
            setShowClearAll(false);
        }
    };

    const startEdit = (term: GlossaryTerm) => {
        setEditingTerm(term);
        setFormData({ ...term });
        setShowAddForm(true);
    };

    const cancelForm = () => {
        setShowAddForm(false);
        setEditingTerm(null);
        setFormData({ english: '', chinese: '', notes: '', category: '' });
    };

    return (
        <div className="bg-slate-800 rounded-xl p-5 text-slate-200">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Book className="w-5 h-5 text-violet-400" />
                    <h2 className="text-lg font-bold">Glossary Manager</h2>
                    <span className="bg-violet-600 text-white text-xs px-2 py-0.5 rounded-full">
                        {terms.length}
                    </span>
                </div>
                <button
                    onClick={loadData}
                    disabled={loading}
                    className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700 transition-colors"
                    title="Refresh"
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {/* Error */}
            {error && (
                <div className="flex items-center gap-2 p-3 bg-red-900/30 border border-red-700 rounded-lg mb-4 text-sm">
                    <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                    <span className="text-red-300">{error}</span>
                    <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}

            {/* Upload result */}
            {uploadResult && (
                <div className={`p-3 rounded-lg mb-4 text-sm border ${
                    uploadResult.success ? 'bg-emerald-900/30 border-emerald-700' : 'bg-red-900/30 border-red-700'
                }`}>
                    <div className="flex items-center gap-2 mb-1">
                        <Check className="w-4 h-4 text-emerald-400" />
                        <strong className="text-emerald-300">Upload Complete</strong>
                    </div>
                    <p className="text-slate-400">
                        Added: {uploadResult.terms_added} · Updated: {uploadResult.terms_updated}
                        {uploadResult.errors.length > 0 && <span className="text-red-400"> · Errors: {uploadResult.errors.length}</span>}
                    </p>
                    <button onClick={() => setUploadResult(null)} className="text-xs text-slate-500 hover:text-slate-300 mt-1">
                        Dismiss
                    </button>
                </div>
            )}

            {/* Search + Filter + Actions */}
            <div className="flex gap-2 mb-4 flex-wrap">
                <div className="flex-1 min-w-[180px] flex items-center bg-slate-700 rounded-lg px-3">
                    <Search className="w-4 h-4 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search terms..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="flex-1 p-2 bg-transparent border-none text-sm text-slate-200 outline-none placeholder:text-slate-500"
                    />
                    {searchQuery && (
                        <button onClick={() => setSearchQuery('')} className="text-slate-400 hover:text-white">
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>

                <div className="flex items-center bg-slate-700 rounded-lg px-3">
                    <Filter className="w-4 h-4 text-slate-400" />
                    <select
                        value={selectedCategory}
                        onChange={(e) => setSelectedCategory(e.target.value)}
                        className="p-2 bg-transparent border-none text-sm text-slate-200 outline-none cursor-pointer"
                    >
                        <option value="">All</option>
                        {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                </div>

                <button
                    onClick={() => setShowAddForm(true)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-500 transition-colors"
                >
                    <Plus className="w-4 h-4" /> Add
                </button>

                <label className="flex items-center gap-1.5 px-3 py-2 bg-slate-700 text-slate-300 text-sm rounded-lg border border-dashed border-slate-600 hover:border-slate-400 cursor-pointer transition-colors">
                    <Upload className="w-4 h-4" /> CSV
                    <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
                </label>
            </div>

            {/* Add/Edit Form */}
            {showAddForm && (
                <form onSubmit={handleSubmit} className="bg-slate-700 rounded-lg p-4 mb-4">
                    <h3 className="text-sm font-semibold mb-3">{editingTerm ? 'Edit Term' : 'Add New Term'}</h3>
                    <div className="grid grid-cols-2 gap-3">
                        <input
                            type="text"
                            placeholder="English *"
                            value={formData.english}
                            onChange={(e) => setFormData({ ...formData, english: e.target.value })}
                            required
                            className="p-2.5 bg-slate-800 border border-slate-600 rounded-lg text-sm text-slate-200 outline-none focus:border-violet-500"
                        />
                        <input
                            type="text"
                            placeholder="Chinese *"
                            value={formData.chinese}
                            onChange={(e) => setFormData({ ...formData, chinese: e.target.value })}
                            required
                            className="p-2.5 bg-slate-800 border border-slate-600 rounded-lg text-sm text-slate-200 outline-none focus:border-violet-500"
                        />
                        <input
                            type="text"
                            placeholder="Category"
                            value={formData.category || ''}
                            onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                            className="p-2.5 bg-slate-800 border border-slate-600 rounded-lg text-sm text-slate-200 outline-none focus:border-violet-500"
                        />
                        <input
                            type="text"
                            placeholder="Notes"
                            value={formData.notes || ''}
                            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                            className="p-2.5 bg-slate-800 border border-slate-600 rounded-lg text-sm text-slate-200 outline-none focus:border-violet-500"
                        />
                    </div>
                    <div className="flex gap-2 mt-3">
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-500 transition-colors"
                        >
                            <Check className="w-4 h-4" />
                            {editingTerm ? 'Update' : 'Add'}
                        </button>
                        <button
                            type="button"
                            onClick={cancelForm}
                            className="px-4 py-2 bg-slate-600 text-slate-300 text-sm rounded-lg hover:bg-slate-500 transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </form>
            )}

            {/* Terms Table */}
            <div className="max-h-[400px] overflow-y-auto">
                {loading && terms.length === 0 ? (
                    <div className="text-center py-10 text-slate-500">
                        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                        Loading...
                    </div>
                ) : terms.length === 0 ? (
                    <div className="text-center py-10 text-slate-500">
                        <Book className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p>No glossary terms yet.</p>
                        <p className="text-xs mt-1">Upload a CSV or add terms manually.</p>
                    </div>
                ) : (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-700">
                                <th className="text-left p-2.5 text-slate-400 font-medium text-xs">English</th>
                                <th className="text-left p-2.5 text-slate-400 font-medium text-xs">Chinese</th>
                                <th className="text-left p-2.5 text-slate-400 font-medium text-xs">Category</th>
                                <th className="text-right p-2.5 text-slate-400 font-medium text-xs">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {terms.map((term) => (
                                <tr key={term.id} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                                    <td className="p-2.5 text-slate-200">{term.english}</td>
                                    <td className="p-2.5 text-slate-200">{term.chinese}</td>
                                    <td className="p-2.5">
                                        {term.category && (
                                            <span className="bg-violet-600/30 text-violet-300 px-2 py-0.5 rounded text-xs">
                                                {term.category}
                                            </span>
                                        )}
                                    </td>
                                    <td className="p-2.5 text-right">
                                        <button
                                            onClick={() => startEdit(term)}
                                            className="p-1 text-violet-400 hover:text-violet-300 transition-colors"
                                            title="Edit"
                                        >
                                            <Edit2 className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => term.id && setDeleteTarget(term.id)}
                                            className="p-1 ml-1 text-red-400 hover:text-red-300 transition-colors"
                                            title="Delete"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Footer */}
            {terms.length > 0 && (
                <div className="mt-4 pt-3 border-t border-slate-700 flex justify-end">
                    <button
                        onClick={() => setShowClearAll(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-red-400 border border-red-700 rounded-lg text-xs hover:bg-red-900/30 transition-colors"
                    >
                        <Trash2 className="w-3.5 h-3.5" /> Clear All
                    </button>
                </div>
            )}

            {/* Confirm Dialogs */}
            <ConfirmDialog
                isOpen={deleteTarget !== null}
                title="Delete Term?"
                message="This glossary term will be permanently deleted."
                confirmLabel="Delete"
                variant="danger"
                onConfirm={confirmDelete}
                onCancel={() => setDeleteTarget(null)}
            />
            <ConfirmDialog
                isOpen={showClearAll}
                title="Clear All Terms?"
                message="This will delete ALL glossary terms. This cannot be undone!"
                confirmLabel="Clear All"
                variant="danger"
                onConfirm={confirmClearAll}
                onCancel={() => setShowClearAll(false)}
            />
        </div>
    );
}
