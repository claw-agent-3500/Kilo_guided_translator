/**
 * Status Dashboard Component
 * Floating panel showing real-time status of backend services.
 */

import { logger } from '../services/logger';
import { useState, useEffect, useCallback } from 'react';
import { Activity, Wifi, WifiOff, ChevronDown, ChevronUp, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

interface ServiceStatus {
    service: string;
    step: string;
    progress: number;
    message: string;
    is_active: boolean;
    elapsed_seconds: number;
}

interface StatusData {
    backend: ServiceStatus;
    mineru: ServiceStatus;
    gemini: ServiceStatus;
}

interface StatusDashboardProps {
    /** Position of the dashboard */
    position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
    /** Start collapsed */
    defaultCollapsed?: boolean;
}

export default function StatusDashboard({
    position = 'bottom-right',
    defaultCollapsed = true,
}: StatusDashboardProps) {
    const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
    const [isConnected, setIsConnected] = useState(false);
    const [statuses, setStatuses] = useState<StatusData | null>(null);
    const [_lastUpdate, setLastUpdate] = useState<Date | null>(null);

    // Connect to SSE stream
    useEffect(() => {
        let eventSource: EventSource | null = null;
        let reconnectTimeout: ReturnType<typeof setTimeout>;

        const connect = () => {
            try {
                eventSource = new EventSource('/api/status/stream');

                eventSource.onopen = () => {
                    setIsConnected(true);
                    logger.log('[StatusDashboard] Connected to status stream');
                };

                eventSource.addEventListener('status', (event) => {
                    try {
                        const data = JSON.parse(event.data) as StatusData;
                        setStatuses(data);
                        setLastUpdate(new Date());
                    } catch (e) {
                        logger.error('[StatusDashboard] Failed to parse status:', e);
                    }
                });

                eventSource.addEventListener('heartbeat', () => {
                    setLastUpdate(new Date());
                });

                eventSource.onerror = () => {
                    setIsConnected(false);
                    eventSource?.close();
                    // Reconnect after 5 seconds
                    reconnectTimeout = setTimeout(connect, 5000);
                };
            } catch (error) {
                logger.error('[StatusDashboard] Failed to connect:', error);
                setIsConnected(false);
            }
        };

        connect();

        return () => {
            eventSource?.close();
            clearTimeout(reconnectTimeout);
        };
    }, []);

    // Format elapsed time
    const formatElapsed = useCallback((seconds: number): string => {
        if (seconds < 60) return `${seconds}s`;
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }, []);

    // Get status icon
    const getStatusIcon = (status: ServiceStatus) => {
        if (!status.is_active) {
            return <CheckCircle size={14} className="text-green-500" />;
        }
        if (status.progress > 0) {
            return <Loader2 size={14} className="text-blue-500 animate-spin" />;
        }
        return <Activity size={14} className="text-slate-400" />;
    };

    // Position classes
    const positionClasses = {
        'bottom-right': 'bottom-4 right-4',
        'bottom-left': 'bottom-4 left-4',
        'top-right': 'top-4 right-4',
        'top-left': 'top-4 left-4',
    };

    // Check if any service is active
    const hasActiveOperation = statuses && (
        statuses.mineru?.is_active ||
        statuses.gemini?.is_active
    );

    // Auto-expand when operation starts
    useEffect(() => {
        if (hasActiveOperation && isCollapsed) {
            setIsCollapsed(false);
        }
    }, [hasActiveOperation, isCollapsed]);

    return (
        <div className={`fixed ${positionClasses[position]} z-40`}>
            <div className="bg-slate-900/95 backdrop-blur-md rounded-xl shadow-2xl border border-slate-700/50 overflow-hidden min-w-[280px]">
                {/* Header - Always visible */}
                <button
                    onClick={() => setIsCollapsed(!isCollapsed)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/50 transition-colors"
                >
                    <div className="flex items-center gap-2">
                        {isConnected ? (
                            <Wifi size={16} className="text-green-400" />
                        ) : (
                            <WifiOff size={16} className="text-red-400" />
                        )}
                        <span className="text-sm font-medium text-slate-200">System Status</span>
                        {hasActiveOperation && (
                            <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                        )}
                    </div>
                    {isCollapsed ? (
                        <ChevronUp size={16} className="text-slate-400" />
                    ) : (
                        <ChevronDown size={16} className="text-slate-400" />
                    )}
                </button>

                {/* Content - Collapsible */}
                {!isCollapsed && statuses && (
                    <div className="px-4 pb-4 space-y-3">
                        {/* Backend Status */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                {getStatusIcon(statuses.backend)}
                                <span className="text-sm text-slate-300">Backend</span>
                            </div>
                            <span className="text-xs text-slate-400">
                                {statuses.backend?.message || 'Ready'}
                            </span>
                        </div>

                        {/* MinerU Status */}
                        <div className="space-y-1">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    {getStatusIcon(statuses.mineru)}
                                    <span className="text-sm text-slate-300">MinerU</span>
                                </div>
                                <span className="text-xs text-slate-400">
                                    {statuses.mineru?.is_active ? statuses.mineru.step : 'Ready'}
                                </span>
                            </div>
                            {statuses.mineru?.is_active && statuses.mineru.progress > 0 && (
                                <div className="flex items-center gap-2">
                                    <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-blue-500 transition-all duration-300"
                                            style={{ width: `${statuses.mineru.progress}%` }}
                                        />
                                    </div>
                                    <span className="text-xs text-slate-500 w-12 text-right">
                                        {statuses.mineru.progress}%
                                    </span>
                                </div>
                            )}
                            {statuses.mineru?.is_active && statuses.mineru.elapsed_seconds > 0 && (
                                <div className="text-xs text-slate-500 text-right">
                                    Elapsed: {formatElapsed(statuses.mineru.elapsed_seconds)}
                                </div>
                            )}
                        </div>

                        {/* Gemini Status */}
                        <div className="space-y-1">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    {getStatusIcon(statuses.gemini)}
                                    <span className="text-sm text-slate-300">Gemini</span>
                                </div>
                                <span className="text-xs text-slate-400">
                                    {statuses.gemini?.is_active ? statuses.gemini.step : 'Ready'}
                                </span>
                            </div>
                            {statuses.gemini?.is_active && statuses.gemini.progress > 0 && (
                                <div className="flex items-center gap-2">
                                    <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-emerald-500 transition-all duration-300"
                                            style={{ width: `${statuses.gemini.progress}%` }}
                                        />
                                    </div>
                                    <span className="text-xs text-slate-500 w-12 text-right">
                                        {statuses.gemini.progress}%
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Connection indicator */}
                        {!isConnected && (
                            <div className="flex items-center gap-2 text-xs text-amber-400 mt-2">
                                <AlertCircle size={12} />
                                <span>Reconnecting...</span>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
