// Saved Projects Panel Component
import { useState, useEffect } from 'react';
import { FolderOpen, Calendar, Trash2, CheckCircle, Loader2 } from 'lucide-react';
import type { Project } from '../types';
import { storageService } from '../services/storageService';
import ConfirmDialog from './ConfirmDialog';

interface SavedProjectsPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onLoadProject: (project: Project) => void;
    currentProjectId?: string;
}

export default function SavedProjectsPanel({ isOpen, onClose, onLoadProject, currentProjectId }: SavedProjectsPanelProps) {
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

    // Load projects when panel opens or refreshes
    const loadProjects = async () => {
        setIsLoading(true);
        try {
            const list = await storageService.listProjects();
            // Sort by last modified (newest first)
            list.sort((a, b) => b.lastModified - a.lastModified);
            setProjects(list);
        } catch (error) {
            console.error('Failed to list projects:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            loadProjects();
        }
    }, [isOpen]);

    const handleDelete = async (e: React.MouseEvent, projectId: string) => {
        e.stopPropagation();
        setDeleteTarget(projectId);
    };

    const confirmDelete = async () => {
        if (deleteTarget) {
            await storageService.deleteProject(deleteTarget);
            setDeleteTarget(null);
            loadProjects();
        }
    };

    const formatDate = (timestamp: number) => {
        return new Date(timestamp).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    // calculate progress percentage
    const getProgress = (p: Project) => {
        if (!p.totalChunks) return 0;
        return Math.round((p.translatedChunks / p.totalChunks) * 100);
    };

    return (
        <>
            {/* Backdrop */}
            {isOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 transition-opacity"
                    onClick={onClose}
                />
            )}

            {/* Sidebar Panel */}
            <div className={`fixed top-0 left-0 h-full w-80 bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                <div className="flex flex-col h-full">
                    {/* Header */}
                    <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                        <div className="flex items-center gap-2">
                            <FolderOpen className="w-5 h-5 text-blue-600" />
                            <h2 className="font-semibold text-slate-800">Saved Projects</h2>
                        </div>
                        <button
                            onClick={onClose}
                            className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-200 transition-colors"
                        >
                            ✕
                        </button>
                    </div>

                    {/* Project List */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                        {isLoading ? (
                            <div className="flex justify-center py-8">
                                <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                            </div>
                        ) : projects.length === 0 ? (
                            <div className="text-center py-8 text-slate-400">
                                <FolderOpen className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                <p>No saved projects found</p>
                            </div>
                        ) : (
                            projects.map(project => (
                                <div
                                    key={project.id}
                                    onClick={() => {
                                        onLoadProject(project);
                                        onClose();
                                    }}
                                    className={`group relative p-3 rounded-lg border transition-all cursor-pointer hover:shadow-md ${currentProjectId === project.id
                                        ? 'bg-blue-50 border-blue-200 ring-1 ring-blue-300'
                                        : 'bg-white border-slate-200 hover:border-blue-300 hover:bg-slate-50'
                                        }`}
                                >
                                    <div className="flex justify-between items-start mb-2">
                                        <h3 className="font-medium text-slate-800 text-sm line-clamp-2 leading-tight" title={project.standardTitle}>
                                            {project.standardTitle}
                                        </h3>
                                        <button
                                            onClick={(e) => handleDelete(e, project.id)}
                                            className="text-slate-400 hover:text-red-500 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                            title="Delete Project"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>

                                    <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                                        <Calendar className="w-3 h-3" />
                                        <span>{formatDate(project.lastModified)}</span>
                                    </div>

                                    {/* Progress Bar */}
                                    <div className="w-full bg-slate-100 rounded-full h-1.5 mb-2 overflow-hidden">
                                        <div
                                            className={`h-full rounded-full ${project.status === 'completed' ? 'bg-emerald-500' : 'bg-blue-500'
                                                }`}
                                            style={{ width: `${getProgress(project)}%` }}
                                        />
                                    </div>

                                    <div className="flex items-center justify-between text-xs">
                                        <div className="flex items-center gap-1.5">
                                            {project.status === 'completed' ? (
                                                <span className="flex items-center gap-1 text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded font-medium">
                                                    <CheckCircle className="w-3 h-3" /> Done
                                                </span>
                                            ) : project.status === 'translating' ? (
                                                <span className="flex items-center gap-1 text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded font-medium">
                                                    <Loader2 className="w-3 h-3 animate-spin" /> {getProgress(project)}%
                                                </span>
                                            ) : (
                                                <span className="text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                                    Idle
                                                </span>
                                            )}
                                        </div>

                                        {currentProjectId === project.id && (
                                            <span className="text-blue-600 font-medium text-[10px] uppercase tracking-wide">
                                                Active
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            <ConfirmDialog
                isOpen={deleteTarget !== null}
                title="Delete Project?"
                message="This will permanently delete the project and all its translation data. This cannot be undone."
                confirmLabel="Delete"
                variant="danger"
                onConfirm={confirmDelete}
                onCancel={() => setDeleteTarget(null)}
            />
        </>
    );
}
