// Unified Glossary Panel
// Merges: Import CSV, Backend CRUD, and Learned Preferences into one tabbed interface

import { useState } from 'react';
import { Book, Upload, BookOpen, GraduationCap, X } from 'lucide-react';
import GlossaryUpload from './GlossaryUpload';
import GlossaryManager from './GlossaryManager';
import UserGlossaryPanel from './UserGlossaryPanel';
import type { GlossaryEntry } from '../types';

interface UnifiedGlossaryPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onGlossaryLoaded: (entries: GlossaryEntry[]) => void;
    currentGlossary: GlossaryEntry[];
}

type Tab = 'import' | 'manage' | 'learned';

export default function UnifiedGlossaryPanel({
    isOpen,
    onClose,
    onGlossaryLoaded,
    currentGlossary,
}: UnifiedGlossaryPanelProps) {
    const [activeTab, setActiveTab] = useState<Tab>('import');

    if (!isOpen) return null;

    const tabs: { id: Tab; label: string; icon: typeof Book; description: string }[] = [
        { id: 'import', label: 'Import', icon: Upload, description: 'Upload a CSV glossary' },
        { id: 'manage', label: 'Manage', icon: Book, description: 'Edit & organize terms' },
        { id: 'learned', label: 'Learned', icon: GraduationCap, description: 'Your edit preferences' },
    ];

    return (
        <div className="fixed inset-0 z-50 flex">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/50" onClick={onClose} />

            {/* Panel */}
            <div className="absolute right-0 top-0 h-full w-full max-w-2xl bg-slate-900 shadow-2xl flex flex-col">
                {/* Header */}
                <div className="flex-shrink-0 border-b border-slate-700">
                    <div className="flex items-center justify-between p-4">
                        <div className="flex items-center gap-3">
                            <BookOpen className="w-6 h-6 text-violet-400" />
                            <h2 className="text-xl font-bold text-white">Glossary</h2>
                            {currentGlossary.length > 0 && (
                                <span className="bg-violet-600 text-white text-xs px-2 py-0.5 rounded-full">
                                    {currentGlossary.length} terms
                                </span>
                            )}
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Tabs */}
                    <div className="flex border-t border-slate-700">
                        {tabs.map((tab) => {
                            const Icon = tab.icon;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`flex-1 flex flex-col items-center gap-1 px-4 py-3 transition-colors ${
                                        activeTab === tab.id
                                            ? 'text-violet-400 border-b-2 border-violet-400 bg-slate-800/50'
                                            : 'text-slate-400 hover:text-white hover:bg-slate-800/30'
                                    }`}
                                >
                                    <Icon className="w-5 h-5" />
                                    <span className="text-sm font-medium">{tab.label}</span>
                                    <span className="text-[10px] text-slate-500">{tab.description}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Tab Content */}
                <div className="flex-1 overflow-y-auto p-4">
                    {activeTab === 'import' && (
                        <GlossaryUpload
                            onGlossaryLoaded={onGlossaryLoaded}
                            currentGlossary={currentGlossary}
                        />
                    )}
                    {activeTab === 'manage' && (
                        <GlossaryManager />
                    )}
                    {activeTab === 'learned' && (
                        <UserGlossaryPanel />
                    )}
                </div>
            </div>
        </div>
    );
}
