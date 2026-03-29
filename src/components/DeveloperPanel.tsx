/**
 * Developer Panel Component
 * 
 * A hideable panel that shows system status for debugging:
 * - Backend connection status
 * - Gemini API key configuration
 * - MinerU API key configuration
 */

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, CheckCircle, XCircle, AlertCircle, RefreshCw, Terminal } from 'lucide-react';
import * as api from '../services/apiClient';

interface StatusItem {
    label: string;
    status: 'ok' | 'error' | 'warning' | 'loading';
    message: string;
}

export default function DeveloperPanel() {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isVisible, setIsVisible] = useState(false);
    const [isChecking, setIsChecking] = useState(false);
    const [statuses, setStatuses] = useState<StatusItem[]>([
        { label: 'Backend Connection', status: 'loading', message: 'Checking...' },
        { label: 'Gemini API Key', status: 'loading', message: 'Checking...' },
        { label: 'MinerU API Key', status: 'loading', message: 'Checking...' },
        { label: 'Gemini Rate Limit', status: 'loading', message: 'Checking...' },
    ]);
    const [lastChecked, setLastChecked] = useState<Date | null>(null);

    const checkAllStatuses = async () => {
        setIsChecking(true);
        const newStatuses: StatusItem[] = [];

        // Check Backend Connection
        try {
            const health = await api.healthCheck();
            if (health.status === 'ok' || health.status === 'healthy') {
                newStatuses.push({
                    label: 'Backend Connection',
                    status: 'ok',
                    message: `Connected to ${api.API_BASE}`
                });
            } else {
                newStatuses.push({
                    label: 'Backend Connection',
                    status: 'warning',
                    message: `Status: ${health.status}`
                });
            }
        } catch (error) {
            newStatuses.push({
                label: 'Backend Connection',
                status: 'error',
                message: `Failed to connect to ${api.API_BASE}`
            });
        }

        // Check API Keys
        try {
            const keyStatus = await api.getKeyStatus();

            // Gemini API Key
            if (keyStatus.gemini_configured) {
                newStatuses.push({
                    label: 'Gemini API Key',
                    status: 'ok',
                    message: `${keyStatus.gemini_key_count} key(s) configured`
                });
            } else {
                newStatuses.push({
                    label: 'Gemini API Key',
                    status: 'error',
                    message: 'Not configured - add via Key icon'
                });
            }

            // MinerU API Key
            if (keyStatus.mineru_configured) {
                newStatuses.push({
                    label: 'MinerU API Key',
                    status: 'ok',
                    message: 'Configured'
                });
            } else {
                newStatuses.push({
                    label: 'MinerU API Key',
                    status: 'warning',
                    message: 'Not configured (optional)'
                });
            }

            // Test Gemini API (rate limit check)
            if (keyStatus.gemini_configured) {
                try {
                    const geminiTest = await api.testGemini();
                    if (geminiTest.rate_limited) {
                        newStatuses.push({
                            label: 'Gemini Rate Limit',
                            status: 'error',
                            message: 'RATE LIMITED - wait or add more keys'
                        });
                    } else if (geminiTest.status === 'ok') {
                        newStatuses.push({
                            label: 'Gemini Rate Limit',
                            status: 'ok',
                            message: 'API working - no rate limit'
                        });
                    } else {
                        newStatuses.push({
                            label: 'Gemini Rate Limit',
                            status: 'warning',
                            message: geminiTest.message.substring(0, 50)
                        });
                    }
                } catch (e) {
                    newStatuses.push({
                        label: 'Gemini Rate Limit',
                        status: 'warning',
                        message: 'Could not test API'
                    });
                }
            }
        } catch (error) {
            newStatuses.push({
                label: 'Gemini API Key',
                status: 'error',
                message: 'Could not check - backend unreachable'
            });
            newStatuses.push({
                label: 'MinerU API Key',
                status: 'error',
                message: 'Could not check - backend unreachable'
            });
        }

        setStatuses(newStatuses);
        setLastChecked(new Date());
        setIsChecking(false);
    };

    // Check on first expand
    useEffect(() => {
        if (isExpanded && !lastChecked) {
            checkAllStatuses();
        }
    }, [isExpanded]);

    const getStatusIcon = (status: StatusItem['status']) => {
        switch (status) {
            case 'ok':
                return <CheckCircle className="w-4 h-4 text-emerald-500" />;
            case 'error':
                return <XCircle className="w-4 h-4 text-red-500" />;
            case 'warning':
                return <AlertCircle className="w-4 h-4 text-amber-500" />;
            case 'loading':
                return <RefreshCw className="w-4 h-4 text-slate-400 animate-spin" />;
        }
    };

    const getStatusBgColor = (status: StatusItem['status']) => {
        switch (status) {
            case 'ok':
                return 'bg-emerald-50 border-emerald-200';
            case 'error':
                return 'bg-red-50 border-red-200';
            case 'warning':
                return 'bg-amber-50 border-amber-200';
            case 'loading':
                return 'bg-slate-50 border-slate-200';
        }
    };

    // Overall status for the collapsed indicator
    const overallStatus = statuses.some(s => s.status === 'error')
        ? 'error'
        : statuses.some(s => s.status === 'warning')
            ? 'warning'
            : statuses.every(s => s.status === 'ok')
                ? 'ok'
                : 'loading';

    // Toggle visibility with Ctrl+Shift+D
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'D') {
                e.preventDefault();
                setIsVisible(v => !v);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    // Collapsed: show just a tiny dot
    if (!isVisible) {
        return (
            <button
                onClick={() => setIsVisible(true)}
                className="fixed bottom-4 right-4 z-50 w-3 h-3 rounded-full bg-slate-300 hover:bg-slate-400 transition-colors"
                title="Developer Panel (Ctrl+Shift+D)"
            />
        );
    }

    return (
        <div className="fixed bottom-4 right-4 z-50">
            <div className={`bg-white rounded-lg shadow-lg border transition-all duration-300 ${isExpanded ? 'w-80' : 'w-auto'
                }`}>
                {/* Toggle Header */}
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="w-full flex items-center justify-between p-3 hover:bg-slate-50 transition-colors rounded-lg"
                >
                    <div className="flex items-center gap-2">
                        <Terminal className="w-4 h-4 text-slate-600" />
                        <span className="text-sm font-medium text-slate-700">Developer</span>
                        {!isExpanded && (
                            <span className={`w-2 h-2 rounded-full ${overallStatus === 'ok' ? 'bg-emerald-500' :
                                overallStatus === 'error' ? 'bg-red-500' :
                                    overallStatus === 'warning' ? 'bg-amber-500' :
                                        'bg-slate-400 animate-pulse'
                                }`} />
                        )}
                    </div>
                    {isExpanded ? (
                        <div className="flex items-center gap-1">
                            <button
                                onClick={(e) => { e.stopPropagation(); setIsVisible(false); }}
                                className="p-1 text-slate-400 hover:text-slate-600 rounded"
                                title="Hide (Ctrl+Shift+D)"
                            >
                                ✕
                            </button>
                            <ChevronDown className="w-4 h-4 text-slate-400" />
                        </div>
                    ) : (
                        <ChevronUp className="w-4 h-4 text-slate-400" />
                    )}
                </button>

                {/* Expanded Content */}
                {isExpanded && (
                    <div className="border-t p-3 space-y-3">
                        {/* Status Items */}
                        <div className="space-y-2">
                            {statuses.map((item, idx) => (
                                <div
                                    key={idx}
                                    className={`flex items-start gap-2 p-2 rounded border ${getStatusBgColor(item.status)}`}
                                >
                                    {getStatusIcon(item.status)}
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-medium text-slate-700">
                                            {item.label}
                                        </div>
                                        <div className="text-xs text-slate-500 truncate">
                                            {item.message}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Refresh Button */}
                        <div className="flex items-center justify-between pt-2 border-t">
                            <span className="text-xs text-slate-400">
                                {lastChecked
                                    ? `Last: ${lastChecked.toLocaleTimeString()}`
                                    : 'Not checked yet'
                                }
                            </span>
                            <button
                                onClick={checkAllStatuses}
                                disabled={isChecking}
                                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded transition-colors disabled:opacity-50"
                            >
                                <RefreshCw className={`w-3 h-3 ${isChecking ? 'animate-spin' : ''}`} />
                                Refresh
                            </button>
                        </div>

                        {/* Backend URL Info */}
                        <div className="text-xs text-slate-400 font-mono bg-slate-100 rounded px-2 py-1">
                            API: {api.API_BASE}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
