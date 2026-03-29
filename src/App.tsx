// Main App Component with Persistence
import { logger } from './services/logger';
import { useState, useEffect, useMemo, useRef } from 'react';
import GlossaryUpload from './components/GlossaryUpload';
import DocumentUpload from './components/DocumentUpload';
import TranslationPanel from './components/TranslationPanel';
import ProgressTracker from './components/ProgressTracker';
import ExportOptions from './components/ExportOptions';
import EditingInterface from './components/EditingInterface';
import RefinementSuggestions from './components/RefinementSuggestions';
import UserGlossaryPanel from './components/UserGlossaryPanel';
import SavedProjectsPanel from './components/SavedProjectsPanel';
import ReviewQueue from './components/ReviewQueue';
import UnifiedGlossaryPanel from './components/UnifiedGlossaryPanel';
import ResumeModal from './components/ResumeModal';
import DeveloperPanel from './components/DeveloperPanel';
import ErrorBoundary from './components/ErrorBoundary';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useToast } from './hooks/useToast';
import { extractStandardTitle } from './services/documentParser';
import { splitIntoChunks } from './services/chunkManager';
import { translateChunks, calculateCoverage, setApiKeys, hasPaidKeys, skipToPaidKey } from './services/geminiService';
import { analyzeEdit, extractTerminologyChanges, RefinementPattern } from './services/editAnalysisService';
import { addUserPreference } from './services/userGlossaryService';
import { storageService } from './services/storageService';
import { exportMarkdown, getDocumentChunks, type BackendChunk } from './services/apiClient';
import ApiKeyManager from './components/ApiKeyManager';
import type { GlossaryEntry, TranslatedChunk, TranslationProgress, AppStatus, Chunk, Project, TokenUsage } from './types';
import TokenStats from './components/TokenStats';
import { Book, FileText, Settings, AlertTriangle, ClipboardCheck, CheckCircle, ChevronRight, Key, FolderOpen, Download, BookOpen } from 'lucide-react';

// Pipeline steps for the wizard-like UI
type PipelineStep = 'setup' | 'translate' | 'review' | 'export';

function getActiveStep(
  status: AppStatus,
  editMode: boolean,
  reviewComplete: boolean,
  translatedChunks: TranslatedChunk[],
): PipelineStep {
  if (reviewComplete || (status === 'complete' && !editMode)) return 'export';
  if (status === 'complete' && editMode) return 'review';
  if (status === 'translating' || (status === 'complete' && translatedChunks.length > 0 && !editMode)) return 'translate';
  return 'setup';
}

export default function App() {
    // Application State
    const [status, setStatus] = useState<AppStatus>('idle');
    const [glossary, setGlossary] = useState<GlossaryEntry[]>([]);
    const [chunks, setChunks] = useState<Chunk[]>([]);
    const [translatedChunks, setTranslatedChunks] = useState<TranslatedChunk[]>([]);
    const [progress, setProgress] = useState<TranslationProgress>({ current: 0, total: 0, percentage: 0, estimatedTimeRemaining: 0, glossaryCoverage: { matched: 0, total: 0 } });
    const [isTranslating, setIsTranslating] = useState(false);

    // Persistence State
    const [currentProject, setCurrentProject] = useState<Project | null>(null);
    const [resumableProject, setResumableProject] = useState<Project | null>(null);
    const [showResumeModal, setShowResumeModal] = useState(false);
    const [pendingFile, setPendingFile] = useState<{ file: File, text: string } | null>(null);
    const [warningMessage, setWarningMessage] = useState<string | null>(null);
    const [showProjectsPanel, setShowProjectsPanel] = useState(false);
    const [showGlossaryPanel, setShowGlossaryPanel] = useState(false);
    const [showReviewPanel, setShowReviewPanel] = useState(false);
    const [loadedDocument, setLoadedDocument] = useState<import('./types').DocumentStructure | null>(null);
    const [showUsePaidButton, setShowUsePaidButton] = useState(false);
    const [lastSaved, setLastSaved] = useState<Date | null>(null);

    // Token Usage Tracking
    const [sessionTokenUsage, setSessionTokenUsage] = useState<TokenUsage>({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });

    // Edit & Refine Mode State
    const [editMode, setEditMode] = useState(false);
    const [currentEditPage, setCurrentEditPage] = useState(0);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [reviewComplete, setReviewComplete] = useState(false);
    const [lastAnalysis, setLastAnalysis] = useState<{
        pattern: RefinementPattern;
        affectedCount: number;
    } | null>(null);

    // Initialize Storage and API Keys
    const [availableApiKeys, setAvailableApiKeys] = useState<{ key: string, isPaid: boolean }[]>([]);
    const translationCancelled = useRef(false);
    const toast = useToast();

    useEffect(() => {
        storageService.init().catch(console.error);

        const storedKeys = localStorage.getItem('gemini_api_keys');
        if (storedKeys) {
            try {
                const parsedKeys = JSON.parse(storedKeys);
                if (Array.isArray(parsedKeys) && parsedKeys.length > 0) {
                    const normalizedKeys = typeof parsedKeys[0] === 'string'
                        ? parsedKeys.map((k: string) => ({ key: k, isPaid: false }))
                        : parsedKeys;
                    setApiKeys(normalizedKeys);
                    setAvailableApiKeys(normalizedKeys);
                }
            } catch (e) {
                console.error("Failed to parse stored API keys", e);
            }
        }
    }, []);

    const handleApiKeysUpdated = (keys: { key: string, isPaid: boolean }[]) => {
        setApiKeys(keys);
        setAvailableApiKeys(keys);
        localStorage.setItem('gemini_api_keys', JSON.stringify(keys));
    };

    // Load Project Handler
    const loadProject = async (project: Project) => {
        logger.debug('DEBUG] loadProject called for:', project.standardTitle, 'status:', project.status);
        try {
            const storedChunks = await storageService.getProjectChunks(project.id);
            logger.debug('DEBUG] Retrieved', storedChunks.length, 'chunks from storage');

            const reconstructedTranslatedChunks: TranslatedChunk[] = storedChunks.map(c => ({
                id: c.chunkId,
                position: c.position,
                text: c.originalText,
                type: c.originalType,
                translation: c.currentTranslation,
                matchedTerms: c.matchedTerms,
                newTerms: []
            }));

            setCurrentProject(project);
            setTranslatedChunks(reconstructedTranslatedChunks);

            const sourceChunks = reconstructedTranslatedChunks.map(c => ({
                id: c.id,
                text: c.text,
                position: c.position,
                type: c.type,
                metadata: c.metadata
            }));
            setChunks(sourceChunks);

            if (project.status === 'completed' || project.status === 'editing') {
                setStatus('complete');
                setProgress(prev => ({
                    ...prev,
                    glossaryCoverage: calculateCoverage(reconstructedTranslatedChunks, glossary)
                }));
            } else if (project.status === 'translating') {
                setStatus('idle');
            } else {
                setStatus('idle');
            }
        } catch (err) {
            console.error("Failed to load project", err);
        }
    };

    const handleResume = async () => {
        if (resumableProject) {
            await loadProject(resumableProject);
            setShowResumeModal(false);
            setPendingFile(null);
            setResumableProject(null);
        }
    };

    const handleStartOver = async () => {
        if (pendingFile) {
            const project: Project = {
                id: crypto.randomUUID(),
                standardTitle: extractStandardTitle(pendingFile.text, pendingFile.file.name),
                lastModified: Date.now(),
                status: 'parsing',
                totalChunks: 0,
                translatedChunks: 0
            };

            await storageService.saveProject(project);
            setCurrentProject(project);

            const backendDocId = loadedDocument?.backendDocId;
            let parsedChunks: Chunk[];

            if (backendDocId) {
                try {
                    const chunkResponse = await getDocumentChunks(backendDocId);
                    parsedChunks = chunkResponse.chunks.map((bc: BackendChunk) => ({
                        id: bc.chunk_tag,
                        text: bc.content,
                        position: bc.index,
                        type: 'paragraph' as const,
                    }));
                } catch (err) {
                    console.error('[DEBUG] Failed to fetch backend chunks:', err);
                    parsedChunks = splitIntoChunks(pendingFile.text);
                }
            } else {
                parsedChunks = splitIntoChunks(pendingFile.text);
            }

            setChunks(parsedChunks);
            setStatus('idle');
            setShowResumeModal(false);
            setPendingFile(null);
            setResumableProject(null);
        }
    };

    const handleGlossaryLoaded = async (entries: GlossaryEntry[]) => {
        setGlossary(entries);
        if (entries.length > 0) {
            toast.success(`Glossary loaded: ${entries.length} terms`);
        }
    };

    const handleDocumentLoaded = async (doc: import('./types').DocumentStructure) => {
        const text = doc.text;
        setLoadedDocument(doc);

        const standardTitle = extractStandardTitle(text, "Document");

        const existingProject = await storageService.getProjectByTitle(standardTitle);

        if (existingProject) {
            setResumableProject(existingProject);
            setPendingFile({ file: new File([text], "document.pdf"), text });
            setShowResumeModal(true);
        } else {
            const project: Project = {
                id: crypto.randomUUID(),
                standardTitle,
                lastModified: Date.now(),
                status: 'parsing',
                totalChunks: 0,
                translatedChunks: 0
            };
            await storageService.saveProject(project);
            setCurrentProject(project);

            const parsedChunks = splitIntoChunks(text);
            setChunks(parsedChunks);
            setStatus('idle');
        }
    };

    const handleStartTranslation = async () => {
        if (!currentProject) return;

        setIsTranslating(true);
        setStatus('translating');
        setWarningMessage(null);
        translationCancelled.current = false;

        const updatedProject = { ...currentProject, status: 'translating', totalChunks: chunks.length } as Project;
        await storageService.saveProject(updatedProject);
        setCurrentProject(updatedProject);

        const startTime = Date.now();
        setSessionTokenUsage({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });

        const startIndex = translatedChunks.length;
        const chunksToTranslate = chunks.slice(startIndex);

        if (chunksToTranslate.length === 0) {
            setIsTranslating(false);
            setStatus('complete');
            return;
        }

        await translateChunks(chunksToTranslate, glossary, async (current, total) => {
            const globalCurrent = startIndex + current;
            const globalTotal = chunks.length;

            const elapsed = (Date.now() - startTime) / 1000;
            const rate = current / elapsed;
            const remaining = Math.max(0, Math.round((total - current) / rate));

            setProgress({
                current: globalCurrent,
                total: globalTotal,
                percentage: Math.round((globalCurrent / globalTotal) * 100),
                estimatedTimeRemaining: remaining,
                glossaryCoverage: {
                    matched: 0,
                    total: glossary.length
                }
            });

            if (currentProject) {
                await storageService.updateProjectProgress(currentProject.id, globalCurrent);
            }
        }, (statusMsg: string) => {
            setWarningMessage(statusMsg);
            if (statusMsg.includes('⏱️') && hasPaidKeys()) {
                setShowUsePaidButton(true);
            } else {
                setShowUsePaidButton(false);
            }
        }, async (chunkResult: TranslatedChunk) => {
            if (chunkResult.tokenUsage) {
                setSessionTokenUsage(prev => ({
                    inputTokens: prev.inputTokens + (chunkResult.tokenUsage?.inputTokens || 0),
                    outputTokens: prev.outputTokens + (chunkResult.tokenUsage?.outputTokens || 0),
                    totalTokens: prev.totalTokens + (chunkResult.tokenUsage?.totalTokens || 0)
                }));
            }

            setTranslatedChunks(prev => [...prev, chunkResult]);

            if (currentProject) {
                const chunkData: import('./types').ChunkData = {
                    projectId: currentProject.id,
                    chunkId: chunkResult.id,
                    position: chunkResult.position,
                    originalText: chunkResult.text,
                    originalType: chunkResult.type,
                    initialTranslation: chunkResult.translation,
                    currentTranslation: chunkResult.translation,
                    matchedTerms: chunkResult.matchedTerms
                };
                await storageService.saveChunks([chunkData]);
                setLastSaved(new Date());
            }
        });

        const finalCoverage = calculateCoverage(translatedChunks, glossary);

        setProgress(prev => ({
            ...prev,
            percentage: 100,
            glossaryCoverage: finalCoverage
        }));

        setIsTranslating(false);
        setStatus('complete');
        setWarningMessage(null);
        toast.success(`Translation complete! ${translatedChunks.length} chunks translated.`);

        const completedProject = {
            ...updatedProject,
            status: 'completed',
            translatedChunks: translatedChunks.length,
            lastModified: Date.now()
        } as Project;

        await storageService.saveProject(completedProject);
    };

    const handleCancelTranslation = () => {
        translationCancelled.current = true;
        setIsTranslating(false);
        setStatus('idle');
        setWarningMessage(null);
        setShowUsePaidButton(false);
    };

    const handleExportMarkdown = async () => {
        const docId = loadedDocument?.backendDocId;
        if (!docId) {
            alert('No backend document ID. Please re-upload the document to generate a skeleton.');
            return;
        }
        try {
            const blob = await exportMarkdown(docId, true);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = (currentProject?.standardTitle || 'translation') + '_translated.md';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('[Export Markdown] Failed:', err);
            alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    };

    const editingChunks = useMemo(() => {
        const start = currentEditPage * 4;
        return translatedChunks.slice(start, start + 4);
    }, [translatedChunks, currentEditPage]);

    const handleEditSubmit = async (editedBatch: TranslatedChunk[]) => {
        if (!editedBatch || editedBatch.length === 0 || !editingChunks || editingChunks.length === 0) {
            return;
        }

        setIsAnalyzing(true);
        try {
            const originalChunk = editingChunks[0];
            const editedChunk = editedBatch[0];

            if (!originalChunk || !editedChunk) {
                setIsAnalyzing(false);
                return;
            }

            const diff = {
                chunkId: originalChunk.id,
                originalTranslation: originalChunk.translation,
                editedTranslation: editedChunk.translation,
                englishContext: originalChunk.text
            };

            let patterns: RefinementPattern[] = [];
            if (originalChunk.translation !== editedChunk.translation) {
                patterns = await analyzeEdit(diff);
            }

            let updatedAllChunks = [...translatedChunks];
            let totalApplied = 0;
            const appliedPatterns: RefinementPattern[] = [];

            if (patterns && patterns.length > 0) {
                for (const pattern of patterns) {
                    if (pattern.type === 'terminology' && pattern.oldTerm && pattern.newTerm) {
                        let appliedCount = 0;
                        updatedAllChunks = updatedAllChunks.map(chunk => {
                            if (chunk.translation.includes(pattern.oldTerm!)) {
                                const newText = chunk.translation.split(pattern.oldTerm!).join(pattern.newTerm!);
                                if (newText !== chunk.translation) {
                                    appliedCount++;
                                    return { ...chunk, translation: newText };
                                }
                            }
                            return chunk;
                        });

                        if (appliedCount > 0) {
                            totalApplied += appliedCount;
                            appliedPatterns.push(pattern);
                        }
                    }
                }
            }

            editedBatch.forEach(edited => {
                const index = updatedAllChunks.findIndex(c => c.id === edited.id);
                if (index !== -1) updatedAllChunks[index] = edited;
            });

            setTranslatedChunks(updatedAllChunks);

            if (appliedPatterns.length > 0) {
                setLastAnalysis({ pattern: appliedPatterns[0], affectedCount: totalApplied });
            }

            if (appliedPatterns.length > 0) {
                const changes = extractTerminologyChanges(appliedPatterns);
                changes.forEach(change => {
                    addUserPreference(
                        change.english,
                        change.oldChinese,
                        change.newChinese,
                        originalChunk.position,
                        originalChunk.text.substring(0, 100)
                    );
                });
            }

            if (currentProject) {
                const chunkDataList = updatedAllChunks.map(c => ({
                    projectId: currentProject.id,
                    chunkId: c.id,
                    position: c.position,
                    originalText: c.text,
                    originalType: c.type,
                    initialTranslation: c.translation,
                    currentTranslation: c.translation,
                    matchedTerms: c.matchedTerms
                }));
                await storageService.saveChunks(chunkDataList);
                await storageService.saveProject({
                    ...currentProject,
                    lastModified: Date.now()
                });
            }

        } catch (error) {
            console.error("Analysis failed", error);
        } finally {
            setIsAnalyzing(false);
        }
    };

    // Keyboard shortcuts
    useKeyboardShortcuts({
        'Escape': () => {
            if (showGlossaryPanel) setShowGlossaryPanel(false);
            else if (showReviewPanel) setShowReviewPanel(false);
            else if (showProjectsPanel) setShowProjectsPanel(false);
            else if (showResumeModal) setShowResumeModal(false);
        },
    }, [showGlossaryPanel, showReviewPanel, showProjectsPanel, showResumeModal]);

    // Derived state for the pipeline
    const activeStep = getActiveStep(status, editMode, reviewComplete, translatedChunks);
    const hasApiKeys = availableApiKeys.length > 0;
    const hasGlossary = glossary.length > 0;
    const hasDocument = chunks.length > 0;

    // Pipeline step definitions
    const pipelineSteps = [
        { id: 'setup' as PipelineStep, label: 'Setup', icon: Key, description: 'Configure API key & upload files' },
        { id: 'translate' as PipelineStep, label: 'Translate', icon: FileText, description: 'AI-powered translation' },
        { id: 'review' as PipelineStep, label: 'Review', icon: ClipboardCheck, description: 'Edit & refine results' },
        { id: 'export' as PipelineStep, label: 'Export', icon: Download, description: 'Download your translation' },
    ];

    const stepIndex = pipelineSteps.findIndex(s => s.id === activeStep);

    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
            {/* Header */}
            <header className="bg-white border-b sticky top-0 z-10 shadow-sm">
                <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="bg-blue-600 p-2 rounded-lg">
                            <Book className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Guided Translator</h1>
                            <p className="text-sm text-slate-500 font-medium">Terminology-Aware Technical Translation</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        {currentProject && (
                            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-blue-50 rounded-full border border-blue-100">
                                <FileText className="w-3 h-3 text-blue-600" />
                                <span className="text-xs font-semibold text-blue-700 truncate max-w-[150px]">
                                    {currentProject.standardTitle}
                                </span>
                                {lastSaved && (
                                    <span className="text-[10px] text-emerald-600 flex items-center gap-0.5">
                                        <CheckCircle className="w-3 h-3" /> Saved
                                    </span>
                                )}
                            </div>
                        )}

                        {/* Projects */}
                        <button
                            onClick={() => setShowProjectsPanel(true)}
                            className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Saved Projects"
                        >
                            <FolderOpen className="w-5 h-5" />
                        </button>

                        {/* Glossary */}
                        <button
                            onClick={() => setShowGlossaryPanel(true)}
                            className="p-2 text-slate-500 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors"
                            title="Glossary"
                        >
                            <BookOpen className="w-5 h-5" />
                        </button>

                        {/* Review */}
                        <button
                            onClick={() => setShowReviewPanel(true)}
                            className="p-2 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                            title="Review Queue"
                        >
                            <ClipboardCheck className="w-5 h-5" />
                        </button>

                        {/* API Key Manager */}
                        <ApiKeyManager
                            onKeysUpdated={handleApiKeysUpdated}
                            initialKeys={JSON.parse(localStorage.getItem('gemini_api_keys') || '[]')}
                        />
                    </div>
                </div>
            </header>

            {/* Pipeline Progress Bar */}
            <div className="bg-white border-b">
                <div className="max-w-7xl mx-auto px-6 py-3">
                    <div className="flex items-center justify-between">
                        {pipelineSteps.map((step, idx) => {
                            const StepIcon = step.icon;
                            const isActive = step.id === activeStep;
                            const isComplete = idx < stepIndex;

                            return (
                                <div key={step.id} className="flex items-center flex-1">
                                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all ${
                                        isActive ? 'bg-blue-50 border border-blue-200' :
                                        isComplete ? 'opacity-70' :
                                        'opacity-40'
                                    }`}>
                                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                                            isActive ? 'bg-blue-600 text-white' :
                                            isComplete ? 'bg-emerald-500 text-white' :
                                            'bg-slate-200 text-slate-500'
                                        }`}>
                                            {isComplete ? <CheckCircle className="w-4 h-4" /> : <StepIcon className="w-4 h-4" />}
                                        </div>
                                        <div className="hidden sm:block">
                                            <p className={`text-sm font-semibold ${
                                                isActive ? 'text-blue-700' : isComplete ? 'text-emerald-700' : 'text-slate-400'
                                            }`}>{step.label}</p>
                                            {isActive && <p className="text-xs text-slate-500">{step.description}</p>}
                                        </div>
                                    </div>
                                    {idx < pipelineSteps.length - 1 && (
                                        <ChevronRight className={`w-4 h-4 mx-1 flex-shrink-0 ${
                                            isComplete ? 'text-emerald-400' : 'text-slate-200'
                                        }`} />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Resume Modal */}
            {showResumeModal && resumableProject && (
                <ResumeModal
                    project={resumableProject}
                    onResume={handleResume}
                    onStartOver={handleStartOver}
                />
            )}

            <ErrorBoundary>
            <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">

                {/* Warning Banner */}
                {warningMessage && (
                    <div className="bg-amber-100 border-l-4 border-amber-500 text-amber-700 p-4 rounded shadow-md">
                        <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-2">
                                <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                                <div>
                                    <p className="font-bold">Rate Limit Warning</p>
                                    <p className="text-sm">{warningMessage}</p>
                                </div>
                            </div>
                            {showUsePaidButton && hasPaidKeys() && (
                                <button
                                    onClick={() => {
                                        if (skipToPaidKey()) {
                                            setWarningMessage('Switched to Paid API key. Retrying...');
                                            setShowUsePaidButton(false);
                                        }
                                    }}
                                    className="px-4 py-2 bg-amber-600 text-white font-semibold rounded-lg hover:bg-amber-700 transition-colors flex items-center gap-2 whitespace-nowrap"
                                >
                                    <span>💰</span>
                                    Use Paid API
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* === STEP: SETUP === */}
                {activeStep === 'setup' && (
                    <div className="space-y-6">
                        {/* Step 0: API Key (if not set) */}
                        {!hasApiKeys && (
                            <div className="bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-200 rounded-2xl p-8 shadow-lg">
                                <div className="flex items-start gap-4">
                                    <div className="bg-amber-500 p-3 rounded-xl">
                                        <Key className="w-7 h-7 text-white" />
                                    </div>
                                    <div className="flex-1">
                                        <h2 className="text-xl font-bold text-slate-900 mb-1">Step 0: Add Your API Key</h2>
                                        <p className="text-slate-600 mb-4">You need a Google Gemini API key to power the translation engine.</p>
                                        <div className="flex items-center gap-3">
                                            <ApiKeyManager
                                                onKeysUpdated={handleApiKeysUpdated}
                                                initialKeys={[]}
                                                inline={true}
                                            />
                                            <a
                                                href="https://aistudio.google.com/"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-sm text-blue-600 hover:text-blue-800 underline font-medium"
                                            >
                                                Get a free API key →
                                            </a>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Steps 1 & 2: Glossary + Document */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className={`relative ${hasGlossary ? '' : ''}`}>
                                <div className="absolute -top-3 -left-1 z-10 bg-violet-600 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow">
                                    1
                                </div>
                                <GlossaryUpload
                                    onGlossaryLoaded={handleGlossaryLoaded}
                                    currentGlossary={glossary}
                                />
                                <p className="text-xs text-slate-400 mt-2 text-center">
                                    Optional — improves terminology consistency
                                </p>
                            </div>
                            <div className="relative">
                                <div className="absolute -top-3 -left-1 z-10 bg-blue-600 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow">
                                    2
                                </div>
                                <DocumentUpload
                                    onDocumentLoaded={handleDocumentLoaded}
                                    currentDocument={loadedDocument}
                                    apiKeys={availableApiKeys}
                                />
                            </div>
                        </div>

                        {/* Chunk Preview */}
                        {hasDocument && (
                            <div className="bg-white rounded-xl shadow-lg p-6 border border-slate-200">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                                        <FileText className="w-5 h-5 text-blue-600" />
                                        Document Ready ({chunks.length} chunks)
                                    </h3>
                                    {hasApiKeys && (
                                        <span className="text-sm text-emerald-600 font-medium flex items-center gap-1">
                                            <CheckCircle className="w-4 h-4" /> Ready to translate
                                        </span>
                                    )}
                                </div>

                                {/* Chunk Stats Bar */}
                                <div className="flex flex-wrap items-center gap-3 mb-4 text-xs text-slate-500">
                                    <span className="bg-slate-100 px-2.5 py-1 rounded-full font-medium">
                                        ~{chunks.reduce((sum, c) => sum + c.text.split(/\s+/).length, 0).toLocaleString()} words
                                    </span>
                                    {['heading', 'paragraph', 'list', 'table'].map(type => {
                                        const count = chunks.filter(c => c.type === type).length;
                                        if (count === 0) return null;
                                        return (
                                            <span key={type} className="bg-slate-100 px-2.5 py-1 rounded-full">
                                                {count} {type}{count !== 1 ? 's' : ''}
                                            </span>
                                        );
                                    })}
                                    {loadedDocument && (
                                        <span className="bg-slate-100 px-2.5 py-1 rounded-full">
                                            {loadedDocument.pages} page{loadedDocument.pages !== 1 ? 's' : ''}
                                        </span>
                                    )}
                                </div>
                                <div className="space-y-3 max-h-60 overflow-y-auto">
                                    {chunks.slice(0, 3).map((chunk, idx) => (
                                        <div key={chunk.id} className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                                            <div className="flex items-center gap-2 mb-1.5">
                                                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded">
                                                    Chunk {idx + 1}
                                                </span>
                                                <span className="text-xs text-slate-400">
                                                    {chunk.text.split(/\s+/).length} words · {chunk.type}
                                                </span>
                                            </div>
                                            <p className="text-sm text-slate-600 line-clamp-2">
                                                {chunk.text.substring(0, 200)}
                                            </p>
                                        </div>
                                    ))}
                                    {chunks.length > 3 && (
                                        <p className="text-center text-sm text-slate-400 py-1">
                                            ...and {chunks.length - 3} more chunks
                                        </p>
                                    )}
                                </div>

                                {/* Start Translation CTA */}
                                {hasApiKeys && (
                                    <div className="mt-6 pt-4 border-t border-slate-100 flex justify-center">
                                        <button
                                            onClick={handleStartTranslation}
                                            className="group relative px-10 py-4 bg-blue-600 text-white text-lg font-bold rounded-xl shadow-xl hover:bg-blue-700 transform hover:-translate-y-0.5 transition-all"
                                        >
                                            <span className="flex items-center gap-2">
                                                🚀 Start Translation
                                                <ChevronRight className="w-5 h-5" />
                                            </span>
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* === STEP: TRANSLATE === */}
                {activeStep === 'translate' && (
                    <div className="space-y-6">
                        {/* Progress */}
                        {isTranslating && (
                            <div className="space-y-4">
                                <ProgressTracker progress={progress} isTranslating={isTranslating} translatedChunks={translatedChunks} />
                                <div className="flex items-center justify-between">
                                    <TokenStats usage={{
                                        input: sessionTokenUsage.inputTokens,
                                        output: sessionTokenUsage.outputTokens,
                                        total: sessionTokenUsage.totalTokens
                                    }} />
                                    <button
                                        onClick={handleCancelTranslation}
                                        className="px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 border border-red-200 transition-all font-medium text-sm flex items-center gap-2"
                                    >
                                        ✕ Cancel Translation
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Translation View */}
                        <TranslationPanel
                            chunks={translatedChunks}
                            isTranslating={isTranslating}
                        />

                        {/* Post-translation actions */}
                        {status === 'complete' && !editMode && !reviewComplete && (
                            <div className="bg-white rounded-xl shadow-lg p-6 border border-slate-200">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="bg-emerald-100 p-2 rounded-lg">
                                        <CheckCircle className="w-6 h-6 text-emerald-600" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-900">Translation Complete</h3>
                                        <p className="text-sm text-slate-500">{translatedChunks.length} chunks translated</p>
                                    </div>
                                    {sessionTokenUsage.totalTokens > 0 && (
                                        <div className="ml-auto">
                                            <TokenStats usage={{
                                                input: sessionTokenUsage.inputTokens,
                                                output: sessionTokenUsage.outputTokens,
                                                total: sessionTokenUsage.totalTokens
                                            }} />
                                        </div>
                                    )}
                                </div>
                                <div className="flex flex-wrap gap-3">
                                    <button
                                        onClick={() => setEditMode(true)}
                                        className="flex-1 min-w-[200px] px-6 py-3 bg-violet-600 text-white rounded-xl hover:bg-violet-700 shadow-lg shadow-violet-200 transition-all font-semibold flex items-center justify-center gap-2"
                                    >
                                        <Settings className="w-4 h-4" />
                                        Edit & Refine
                                    </button>
                                    <button
                                        onClick={handleStartTranslation}
                                        className="px-6 py-3 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition-all font-semibold flex items-center justify-center gap-2"
                                    >
                                        🔄 Re-Translate
                                    </button>
                                    {loadedDocument?.backendDocId && (
                                        <button
                                            onClick={handleExportMarkdown}
                                            className="px-6 py-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 shadow-lg shadow-emerald-200 transition-all font-semibold flex items-center justify-center gap-2"
                                        >
                                            ↓ Export Markdown
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* === STEP: REVIEW === */}
                {activeStep === 'review' && (
                    <div className="space-y-6">
                        {/* Suggestions */}
                        {lastAnalysis && (
                            <RefinementSuggestions
                                patterns={[lastAnalysis.pattern]}
                                appliedContexts={new Map()}
                                onClose={() => setLastAnalysis(null)}
                            />
                        )}

                        <EditingInterface
                            chunks={editingChunks}
                            allChunks={translatedChunks}
                            currentPage={currentEditPage}
                            totalPages={Math.ceil(translatedChunks.length / 4)}
                            onSubmit={handleEditSubmit}
                            onNavigate={setCurrentEditPage}
                            onReviewComplete={() => {
                                setEditMode(false);
                                setReviewComplete(true);
                            }}
                            isAnalyzing={isAnalyzing}
                        />

                        <UserGlossaryPanel />
                    </div>
                )}

                {/* === STEP: EXPORT === */}
                {activeStep === 'export' && (
                    <div className="space-y-6">
                        {/* Completion Banner */}
                        <div className="bg-emerald-50 border-2 border-emerald-200 rounded-2xl p-8 shadow-lg text-center">
                            <div className="flex justify-center mb-4">
                                <div className="w-20 h-20 bg-emerald-500 rounded-full flex items-center justify-center shadow-lg">
                                    <CheckCircle className="w-12 h-12 text-white" />
                                </div>
                            </div>
                            <h2 className="text-2xl font-bold mb-2 text-emerald-800">All Done! 🎉</h2>
                            <p className="text-emerald-700 text-lg mb-4">
                                Your translation is ready. Download it in your preferred format.
                            </p>
                            <div className="flex justify-center gap-2 text-sm">
                                <span className="px-3 py-1 bg-emerald-200 text-emerald-800 rounded-full font-medium">
                                    {translatedChunks.length} chunks
                                </span>
                                {currentProject && (
                                    <span className="px-3 py-1 bg-emerald-200 text-emerald-800 rounded-full font-medium">
                                        {currentProject.standardTitle}
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Export Options */}
                        <ExportOptions translatedChunks={translatedChunks} />

                        {/* Start Over */}
                        <div className="text-center">
                            <button
                                onClick={() => {
                                    setStatus('idle');
                                    setChunks([]);
                                    setTranslatedChunks([]);
                                    setCurrentProject(null);
                                    setLoadedDocument(null);
                                    setEditMode(false);
                                    setReviewComplete(false);
                                    setLastAnalysis(null);
                                }}
                                className="px-6 py-3 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 transition-all font-medium"
                            >
                                ← Start a New Translation
                            </button>
                        </div>
                    </div>
                )}
            </main>
            </ErrorBoundary>

            {/* Saved Projects Panel */}
            <SavedProjectsPanel
                isOpen={showProjectsPanel}
                onClose={() => setShowProjectsPanel(false)}
                onLoadProject={loadProject}
                currentProjectId={currentProject?.id}
            />

            {/* Unified Glossary Panel */}
            <UnifiedGlossaryPanel
                isOpen={showGlossaryPanel}
                onClose={() => setShowGlossaryPanel(false)}
                onGlossaryLoaded={handleGlossaryLoaded}
                currentGlossary={glossary}
            />

            {/* Review Panel */}
            {showReviewPanel && (
                <div className="fixed inset-0 z-50 flex">
                    <div className="absolute inset-0 bg-black/50" onClick={() => setShowReviewPanel(false)} />
                    <div className="absolute right-0 top-0 h-full w-full max-w-2xl bg-slate-900 shadow-2xl overflow-y-auto">
                        <div className="sticky top-0 bg-slate-900 border-b border-slate-700 p-4 flex items-center justify-between z-10">
                            <div className="flex items-center gap-3">
                                <ClipboardCheck className="w-6 h-6 text-emerald-400" />
                                <h2 className="text-xl font-bold text-white">Review Queue</h2>
                            </div>
                            <button onClick={() => setShowReviewPanel(false)} className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800">✕</button>
                        </div>
                        <div className="p-4">
                            <ReviewQueue />
                        </div>
                    </div>
                </div>
            )}

            {/* Developer Panel - collapsible, bottom-right */}
            <DeveloperPanel />

            {/* Toast Notifications */}
            <toast.ToastContainer />
        </div>
    );
}
