// Review Queue Component - Redesigned for better readability
// Displays nodes needing review with approve/edit/retranslate actions

import { useState, useEffect, useCallback } from 'react';
import {
    ClipboardCheck,
    Check,
    Edit2,
    RefreshCw,
    AlertTriangle,
    FileText,
    ChevronDown,
    ChevronUp,
    RotateCcw,
    Eye,
    EyeOff
} from 'lucide-react';
import {
    ReviewNode,
    DocumentStats,
    getReviewQueue,
    getDocumentStats,
    approveNode,
    editNode,
    retranslateNode
} from '../services/apiClient';

interface ReviewQueueProps {
    documentId?: number;
    onNodeUpdated?: () => void;
}

export default function ReviewQueue({ documentId, onNodeUpdated }: ReviewQueueProps) {
    // State
    const [nodes, setNodes] = useState<ReviewNode[]>([]);
    const [stats, setStats] = useState<DocumentStats | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Edit mode
    const [editingNodeId, setEditingNodeId] = useState<number | null>(null);
    const [editText, setEditText] = useState('');

    // Expanded nodes
    const [expandedNodes, setExpandedNodes] = useState<Set<number>>(new Set());

    // View mode toggle
    const [showOriginal, setShowOriginal] = useState(true);

    // Load data
    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const nodesData = await getReviewQueue(documentId);
            setNodes(nodesData);

            if (documentId) {
                const statsData = await getDocumentStats(documentId);
                setStats(statsData);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load review queue');
        } finally {
            setLoading(false);
        }
    }, [documentId]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // Handle approve
    const handleApprove = async (nodeId: number) => {
        setLoading(true);
        try {
            await approveNode(nodeId);
            await loadData();
            onNodeUpdated?.();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Approve failed');
        } finally {
            setLoading(false);
        }
    };

    // Handle edit submit
    const handleEditSubmit = async (nodeId: number) => {
        if (!editText.trim()) return;

        setLoading(true);
        try {
            await editNode(nodeId, editText);
            setEditingNodeId(null);
            setEditText('');
            await loadData();
            onNodeUpdated?.();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Edit failed');
        } finally {
            setLoading(false);
        }
    };

    // Handle retranslate
    const handleRetranslate = async (nodeId: number) => {
        setLoading(true);
        try {
            await retranslateNode(nodeId);
            await loadData();
            onNodeUpdated?.();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Retranslate failed');
        } finally {
            setLoading(false);
        }
    };

    // Start editing
    const startEdit = (node: ReviewNode) => {
        setEditingNodeId(node.id);
        setEditText(node.translation || '');
    };

    // Cancel edit
    const cancelEdit = () => {
        setEditingNodeId(null);
        setEditText('');
    };

    // Toggle expand
    const toggleExpand = (nodeId: number) => {
        setExpandedNodes(prev => {
            const next = new Set(prev);
            if (next.has(nodeId)) {
                next.delete(nodeId);
            } else {
                next.add(nodeId);
            }
            return next;
        });
    };

    // Detect whether text is an HTML table chunk (including orphaned rows/cells)
    const isHtmlTable = (text: string) => /<table[\s>]|<tr[\s>]|<td[\s>]/i.test(text);

    // Inject scoped table styles and ensure <table> wrapper exists
    const styledTableHtml = (html: string) => {
        const style = `
        <style>
            .rq-table { border-collapse: collapse; width: 100%; font-size: 14px; }
            .rq-table td, .rq-table th {
                border: 1px solid #e2e8f0;
                padding: 10px 14px;
                text-align: left;
                vertical-align: top;
                line-height: 1.6;
            }
            .rq-table tr:nth-child(odd)  { background: #f8fafc; }
            .rq-table tr:nth-child(even) { background: #ffffff; }
            .rq-table tr:first-child td, .rq-table tr:first-child th {
                background: #e0f2fe;
                font-weight: 600;
                color: #0369a1;
            }
        </style>
        `;
        
        // If the LLM stripped the <table tags, we must wrap it to force layout
        let finalizedHtml = html;
        if (!/<table/i.test(html) && /<tr|<td/i.test(html)) {
            finalizedHtml = `<table class="rq-table">${html}</table>`;
        } else {
            finalizedHtml = html.replace(/<table/gi, '<table class="rq-table"');
        }

        return style + finalizedHtml;
    };

    // Render a chunk — HTML table or plain text
    const renderContent = (text: string | null | undefined, fallback: string = 'No content', isOriginal: boolean = false) => {
        if (!text) return <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>{fallback}</span>;
        if (isHtmlTable(text)) {
            return (
                <div style={{ overflowX: 'auto' }}>
                    <div
                        dangerouslySetInnerHTML={{ __html: styledTableHtml(text) }}
                    />
                </div>
            );
        }
        return <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{text}</span>;
    };

    // Get state badge color
    const getStateBadge = (state: ReviewNode['state']) => {
        const colors: Record<ReviewNode['state'], { bg: string; text: string; label: string }> = {
            pending: { bg: '#dbeafe', text: '#1d4ed8', label: 'Pending' },
            translating: { bg: '#fef3c7', text: '#b45309', label: 'Translating' },
            review: { bg: '#ede9fe', text: '#7c3aed', label: 'In Review' },
            approved: { bg: '#dcfce7', text: '#15803d', label: 'Approved' },
            completed: { bg: '#d1fae5', text: '#059669', label: 'Completed' },
            failed: { bg: '#fee2e2', text: '#dc2626', label: 'Failed' }
        };
        return colors[state] || { bg: '#f1f5f9', text: '#475569', label: state };
    };

    // Expand all / Collapse all
    const expandAll = () => {
        setExpandedNodes(new Set(nodes.map(n => n.id)));
    };

    const collapseAll = () => {
        setExpandedNodes(new Set());
    };

    return (
        <div className="review-queue" style={{
            backgroundColor: '#ffffff',
            borderRadius: '16px',
            padding: '24px',
            color: '#1e293b',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)'
        }}>
            {/* Header */}
            <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between', 
                marginBottom: '20px',
                flexWrap: 'wrap',
                gap: '12px'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                        backgroundColor: '#f0fdf4',
                        padding: '10px',
                        borderRadius: '12px'
                    }}>
                        <ClipboardCheck size={24} color="#16a34a" />
                    </div>
                    <div>
                        <h2 style={{ 
                            margin: 0, 
                            fontSize: '22px', 
                            fontWeight: 600,
                            color: '#0f172a'
                        }}>
                            Review Queue
                        </h2>
                        <p style={{ 
                            margin: '4px 0 0 0', 
                            fontSize: '13px', 
                            color: '#64748b' 
                        }}>
                            Approve or edit translations
                        </p>
                    </div>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {nodes.length > 0 && (
                        <span style={{
                            backgroundColor: nodes.length > 0 ? '#fef3c7' : '#dcfce7',
                            color: nodes.length > 0 ? '#b45309' : '#15803d',
                            padding: '6px 14px',
                            borderRadius: '20px',
                            fontSize: '14px',
                            fontWeight: 500
                        }}>
                            {nodes.length} pending
                        </span>
                    )}
                    <button
                        onClick={() => loadData()}
                        disabled={loading}
                        style={{
                            background: 'none',
                            border: 'none',
                            cursor: loading ? 'wait' : 'pointer',
                            color: '#64748b',
                            padding: '8px',
                            borderRadius: '8px',
                            transition: 'all 0.2s'
                        }}
                        title="Refresh"
                    >
                        <RefreshCw size={20} className={loading ? 'spinning' : ''} />
                    </button>
                </div>
            </div>

            {/* Stats bar */}
            {stats && (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
                    gap: '16px',
                    marginBottom: '20px',
                    padding: '16px',
                    backgroundColor: '#f8fafc',
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0'
                }}>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '28px', fontWeight: 700, color: '#7c3aed' }}>
                            {stats.progress_percent}%
                        </div>
                        <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Progress</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '22px', fontWeight: 600, color: '#3b82f6' }}>{stats.pending}</div>
                        <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Pending</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '22px', fontWeight: 600, color: '#f59e0b' }}>{stats.review}</div>
                        <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>In Review</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '22px', fontWeight: 600, color: '#22c55e' }}>{stats.approved}</div>
                        <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Approved</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '22px', fontWeight: 600, color: '#ef4444' }}>{stats.failed}</div>
                        <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Failed</div>
                    </div>
                </div>
            )}

            {/* Error display */}
            {error && (
                <div style={{
                    backgroundColor: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: '12px',
                    padding: '14px',
                    marginBottom: '20px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px'
                }}>
                    <AlertTriangle size={20} color="#dc2626" />
                    <span style={{ color: '#b91c1c', fontSize: '14px' }}>{error}</span>
                </div>
            )}

            {/* Toolbar */}
            {nodes.length > 0 && (
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '16px',
                    padding: '12px 16px',
                    backgroundColor: '#f1f5f9',
                    borderRadius: '10px'
                }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                            onClick={expandAll}
                            style={{
                                padding: '6px 12px',
                                backgroundColor: '#fff',
                                border: '1px solid #e2e8f0',
                                borderRadius: '6px',
                                fontSize: '13px',
                                color: '#475569',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                            }}
                        >
                            <Eye size={14} /> Expand All
                        </button>
                        <button
                            onClick={collapseAll}
                            style={{
                                padding: '6px 12px',
                                backgroundColor: '#fff',
                                border: '1px solid #e2e8f0',
                                borderRadius: '6px',
                                fontSize: '13px',
                                color: '#475569',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                            }}
                        >
                            <EyeOff size={14} /> Collapse All
                        </button>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '13px', color: '#64748b' }}>Show original:</span>
                        <button
                            onClick={() => setShowOriginal(!showOriginal)}
                            style={{
                                padding: '6px 12px',
                                backgroundColor: showOriginal ? '#7c3aed' : '#fff',
                                color: showOriginal ? '#fff' : '#475569',
                                border: '1px solid',
                                borderColor: showOriginal ? '#7c3aed' : '#e2e8f0',
                                borderRadius: '6px',
                                fontSize: '13px',
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                            }}
                        >
                            {showOriginal ? 'Yes' : 'No'}
                        </button>
                    </div>
                </div>
            )}

            {/* Nodes list */}
            <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
                {loading && nodes.length === 0 ? (
                    <div style={{ 
                        textAlign: 'center', 
                        padding: '60px 40px', 
                        color: '#94a3b8',
                        backgroundColor: '#f8fafc',
                        borderRadius: '12px'
                    }}>
                        <RefreshCw size={32} className="spinning" style={{ marginBottom: '12px' }} />
                        <div style={{ fontSize: '16px' }}>Loading review queue...</div>
                    </div>
                ) : nodes.length === 0 ? (
                    <div style={{ 
                        textAlign: 'center', 
                        padding: '60px 40px', 
                        backgroundColor: '#f0fdf4',
                        borderRadius: '12px',
                        border: '1px solid #bbf7d0'
                    }}>
                        <div style={{
                            backgroundColor: '#dcfce7',
                            padding: '16px',
                            borderRadius: '50%',
                            display: 'inline-flex',
                            marginBottom: '16px'
                        }}>
                            <Check size={32} color="#16a34a" />
                        </div>
                        <div style={{ fontSize: '18px', fontWeight: 500, color: '#15803d' }}>
                            All translations reviewed!
                        </div>
                        <div style={{ fontSize: '14px', color: '#16a34a', marginTop: '8px' }}>
                            Great work! Your document is ready for export.
                        </div>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {nodes.map((node) => {
                            const badge = getStateBadge(node.state);
                            return (
                                <div key={node.id} style={{
                                    backgroundColor: '#ffffff',
                                    borderRadius: '12px',
                                    overflow: 'hidden',
                                    border: '1px solid #e2e8f0',
                                    transition: 'box-shadow 0.2s'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.08)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.boxShadow = 'none';
                                }}
                                >
                                    {/* Node header */}
                                    <div
                                        onClick={() => toggleExpand(node.id)}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '12px',
                                            padding: '14px 16px',
                                            cursor: 'pointer',
                                            borderBottom: expandedNodes.has(node.id) ? '1px solid #e2e8f0' : 'none',
                                            backgroundColor: '#f8fafc'
                                        }}
                                    >
                                        <FileText size={18} color="#64748b" />
                                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <span style={{
                                                fontSize: '14px',
                                                color: '#64748b',
                                                fontWeight: 500
                                            }}>
                                                #{node.index + 1}
                                            </span>
                                            <span style={{
                                                padding: '4px 10px',
                                                borderRadius: '6px',
                                                fontSize: '12px',
                                                fontWeight: 500,
                                                textTransform: 'capitalize',
                                                backgroundColor: badge.bg,
                                                color: badge.text
                                            }}>
                                                {badge.label}
                                            </span>
                                            {node.confidence !== null && (
                                                <span style={{
                                                    fontSize: '13px',
                                                    color: node.confidence < 0.7 ? '#f59e0b' : '#22c55e',
                                                    fontWeight: 500
                                                }}>
                                                    {Math.round(node.confidence * 100)}% confidence
                                                </span>
                                            )}
                                        </div>
                                        {expandedNodes.has(node.id) ? (
                                            <ChevronUp size={18} color="#64748b" />
                                        ) : (
                                            <ChevronDown size={18} color="#64748b" />
                                        )}
                                    </div>

                                    {/* Expanded content */}
                                    {expandedNodes.has(node.id) && (
                                        <div style={{ padding: '20px' }}>
                                            {/* Original text */}
                                            {showOriginal && (
                                                <div style={{ marginBottom: '16px' }}>
                                                    <div style={{
                                                        fontSize: '12px',
                                                        fontWeight: 600,
                                                        color: '#64748b',
                                                        marginBottom: '8px',
                                                        textTransform: 'uppercase',
                                                        letterSpacing: '0.5px'
                                                    }}>
                                                        📄 Original (English)
                                                    </div>
                                                    <div style={{
                                                        padding: '16px',
                                                        backgroundColor: '#f8fafc',
                                                        borderRadius: '10px',
                                                        fontSize: '15px',
                                                        lineHeight: '1.75',
                                                        color: '#334155',
                                                        border: '1px solid #e2e8f0'
                                                    }}>
                                                        {renderContent(node.content, 'No content available', true)}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Translation */}
                                            <div style={{ marginBottom: '16px' }}>
                                                <div style={{
                                                    fontSize: '12px',
                                                    fontWeight: 600,
                                                    color: '#64748b',
                                                    marginBottom: '8px',
                                                    textTransform: 'uppercase',
                                                    letterSpacing: '0.5px'
                                                }}>
                                                    🈯 Translation {node.translation ? '' : '(pending)'}
                                                </div>
                                                {editingNodeId === node.id ? (
                                                    <div>
                                                        <textarea
                                                            className="review-textarea"
                                                            value={editText}
                                                            onChange={(e) => setEditText(e.target.value)}
                                                            placeholder="Enter your translation..."
                                                            style={{
                                                                width: '100%',
                                                                minHeight: '120px',
                                                                padding: '16px',
                                                                backgroundColor: '#ffffff',
                                                                border: '2px solid #7c3aed',
                                                                borderRadius: '10px',
                                                                color: '#1e293b',
                                                                fontSize: '15px',
                                                                lineHeight: '1.7',
                                                                outline: 'none',
                                                                resize: 'vertical',
                                                                fontFamily: "'Noto Sans SC', 'Microsoft YaHei', system-ui, sans-serif"
                                                            }}
                                                        />
                                                        <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
                                                            <button
                                                                onClick={() => handleEditSubmit(node.id)}
                                                                disabled={loading || !editText.trim()}
                                                                style={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '6px',
                                                                    padding: '10px 18px',
                                                                    backgroundColor: editText.trim() ? '#22c55e' : '#94a3b8',
                                                                    color: 'white',
                                                                    border: 'none',
                                                                    borderRadius: '8px',
                                                                    cursor: editText.trim() ? 'pointer' : 'not-allowed',
                                                                    fontSize: '14px',
                                                                    fontWeight: 500
                                                                }}
                                                            >
                                                                <Check size={16} />
                                                                Save Changes
                                                            </button>
                                                            <button
                                                                onClick={cancelEdit}
                                                                style={{
                                                                    padding: '10px 18px',
                                                                    backgroundColor: '#fff',
                                                                    color: '#475569',
                                                                    border: '1px solid #e2e8f0',
                                                                    borderRadius: '8px',
                                                                    cursor: 'pointer',
                                                                    fontSize: '14px',
                                                                    fontWeight: 500
                                                                }}
                                                            >
                                                                Cancel
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div style={{
                                                        padding: '16px',
                                                        backgroundColor: node.translation ? '#f0fdf4' : '#fffbeb',
                                                        borderRadius: '10px',
                                                        fontSize: '15px',
                                                        lineHeight: '1.75',
                                                        color: node.translation ? '#1e293b' : '#94a3b8',
                                                        fontStyle: node.translation ? 'normal' : 'italic',
                                                        border: '1px solid',
                                                        borderColor: node.translation ? '#bbf7d0' : '#fde68a'
                                                    }}>
                                                        {renderContent(node.translation, 'Translation not available yet', false)}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Actions */}
                                            {editingNodeId !== node.id && (
                                                <div style={{ 
                                                    display: 'flex', 
                                                    gap: '10px', 
                                                    paddingTop: '8px',
                                                    borderTop: '1px solid #e2e8f0'
                                                }}>
                                                    <button
                                                        onClick={() => handleApprove(node.id)}
                                                        disabled={loading || !node.translation}
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '6px',
                                                            padding: '10px 18px',
                                                            backgroundColor: node.translation ? '#22c55e' : '#f1f5f9',
                                                            color: node.translation ? 'white' : '#94a3b8',
                                                            border: 'none',
                                                            borderRadius: '8px',
                                                            cursor: node.translation ? 'pointer' : 'not-allowed',
                                                            fontSize: '14px',
                                                            fontWeight: 500
                                                        }}
                                                    >
                                                        <Check size={16} />
                                                        Approve
                                                    </button>
                                                    <button
                                                        onClick={() => startEdit(node)}
                                                        disabled={loading}
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '6px',
                                                            padding: '10px 18px',
                                                            backgroundColor: '#7c3aed',
                                                            color: 'white',
                                                            border: 'none',
                                                            borderRadius: '8px',
                                                            cursor: 'pointer',
                                                            fontSize: '14px',
                                                            fontWeight: 500
                                                        }}
                                                    >
                                                        <Edit2 size={16} />
                                                        Edit
                                                    </button>
                                                    <button
                                                        onClick={() => handleRetranslate(node.id)}
                                                        disabled={loading}
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '6px',
                                                            padding: '10px 18px',
                                                            backgroundColor: '#fff',
                                                            color: '#f59e0b',
                                                            border: '1px solid #fbbf24',
                                                            borderRadius: '8px',
                                                            cursor: 'pointer',
                                                            fontSize: '14px',
                                                            fontWeight: 500
                                                        }}
                                                    >
                                                        <RotateCcw size={16} />
                                                        Retranslate
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* CSS for spinning animation */}
            <style>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                .spinning {
                    animation: spin 1s linear infinite;
                }
            `}</style>
        </div>
    );
}
