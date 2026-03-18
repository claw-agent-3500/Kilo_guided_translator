// Review Queue Component
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
    RotateCcw
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

    // Detect whether text is an HTML table chunk from MinerU
    const isHtmlTable = (text: string) => /<table[\s>]/i.test(text);

    // Inject scoped table styles into the HTML string so the rendered table
    // looks good inside the dark review panel without affecting global CSS.
    const styledTableHtml = (html: string) => `
        <style>
            .rq-table { border-collapse: collapse; width: 100%; font-size: 13px; }
            .rq-table td, .rq-table th {
                border: 1px solid #444;
                padding: 6px 10px;
                text-align: left;
                vertical-align: top;
                line-height: 1.5;
            }
            .rq-table tr:nth-child(odd)  { background: #1e1e30; }
            .rq-table tr:nth-child(even) { background: #25253a; }
            .rq-table tr:first-child td, .rq-table tr:first-child th {
                background: #2d2d4a;
                font-weight: 600;
                color: #c4b5fd;
            }
        </style>
        ${html.replace(/<table/gi, '<table class="rq-table"')}
    `;

    // Render a chunk — HTML table or plain text
    const renderContent = (text: string | null | undefined, fallback: string = 'No content') => {
        if (!text) return <span style={{ color: '#666', fontStyle: 'italic' }}>{fallback}</span>;
        if (isHtmlTable(text)) {
            return (
                <div
                    style={{ overflowX: 'auto' }}
                    dangerouslySetInnerHTML={{ __html: styledTableHtml(text) }}
                />
            );
        }
        return <span style={{ whiteSpace: 'pre-wrap' }}>{text}</span>;
    };

    // Get state badge color
    const getStateBadge = (state: ReviewNode['state']) => {
        const colors: Record<ReviewNode['state'], { bg: string; text: string }> = {
            pending: { bg: '#3b82f6', text: 'white' },
            translating: { bg: '#f59e0b', text: 'white' },
            review: { bg: '#8b5cf6', text: 'white' },
            approved: { bg: '#22c55e', text: 'white' },
            completed: { bg: '#10b981', text: 'white' },
            failed: { bg: '#ef4444', text: 'white' }
        };
        return colors[state] || { bg: '#666', text: 'white' };
    };

    return (
        <div className="review-queue" style={{
            backgroundColor: '#1a1a2e',
            borderRadius: '12px',
            padding: '20px',
            color: '#e0e0e0'
        }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ClipboardCheck size={24} color="#8b5cf6" />
                    <h2 style={{ margin: 0, fontSize: '18px' }}>Review Queue</h2>
                    <span style={{
                        backgroundColor: nodes.length > 0 ? '#f59e0b' : '#22c55e',
                        color: 'white',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '12px'
                    }}>
                        {nodes.length} pending
                    </span>
                </div>
                <button
                    onClick={() => loadData()}
                    disabled={loading}
                    style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: '#888'
                    }}
                    title="Refresh"
                >
                    <RefreshCw size={18} className={loading ? 'spinning' : ''} />
                </button>
            </div>

            {/* Stats bar */}
            {stats && (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))',
                    gap: '12px',
                    marginBottom: '16px',
                    padding: '12px',
                    backgroundColor: '#2a2a3e',
                    borderRadius: '8px'
                }}>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#8b5cf6' }}>
                            {stats.progress_percent}%
                        </div>
                        <div style={{ fontSize: '11px', color: '#888' }}>Progress</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#3b82f6' }}>{stats.pending}</div>
                        <div style={{ fontSize: '11px', color: '#888' }}>Pending</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#f59e0b' }}>{stats.review}</div>
                        <div style={{ fontSize: '11px', color: '#888' }}>Review</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#22c55e' }}>{stats.approved}</div>
                        <div style={{ fontSize: '11px', color: '#888' }}>Approved</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#ef4444' }}>{stats.failed}</div>
                        <div style={{ fontSize: '11px', color: '#888' }}>Failed</div>
                    </div>
                </div>
            )}

            {/* Error display */}
            {error && (
                <div style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid #ef4444',
                    borderRadius: '8px',
                    padding: '12px',
                    marginBottom: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                }}>
                    <AlertTriangle size={18} color="#ef4444" />
                    <span>{error}</span>
                </div>
            )}

            {/* Nodes list */}
            <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
                {loading && nodes.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
                        Loading...
                    </div>
                ) : nodes.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
                        <Check size={48} color="#22c55e" style={{ marginBottom: '12px' }} />
                        <div>All translations reviewed!</div>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {nodes.map((node) => (
                            <div key={node.id} style={{
                                backgroundColor: '#2a2a3e',
                                borderRadius: '8px',
                                overflow: 'hidden'
                            }}>
                                {/* Node header */}
                                <div
                                    onClick={() => toggleExpand(node.id)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '12px',
                                        padding: '12px',
                                        cursor: 'pointer',
                                        borderBottom: expandedNodes.has(node.id) ? '1px solid #333' : 'none'
                                    }}
                                >
                                    <FileText size={16} color="#666" />
                                    <div style={{ flex: 1 }}>
                                        <span style={{
                                            fontSize: '12px',
                                            color: '#888',
                                            marginRight: '8px'
                                        }}>
                                            #{node.index}
                                        </span>
                                        <span style={{
                                            ...getStateBadge(node.state),
                                            padding: '2px 6px',
                                            borderRadius: '4px',
                                            fontSize: '10px',
                                            textTransform: 'uppercase'
                                        }}>
                                            {node.state}
                                        </span>
                                        {node.confidence !== null && (
                                            <span style={{
                                                marginLeft: '8px',
                                                fontSize: '11px',
                                                color: node.confidence < 0.7 ? '#f59e0b' : '#22c55e'
                                            }}>
                                                {Math.round(node.confidence * 100)}% conf
                                            </span>
                                        )}
                                    </div>
                                    {expandedNodes.has(node.id) ? (
                                        <ChevronUp size={16} color="#666" />
                                    ) : (
                                        <ChevronDown size={16} color="#666" />
                                    )}
                                </div>

                                {/* Expanded content */}
                                {expandedNodes.has(node.id) && (
                                    <div style={{ padding: '12px' }}>
                                        {/* Original text */}
                                        <div style={{ marginBottom: '12px' }}>
                                            <div style={{
                                                fontSize: '11px',
                                                color: '#888',
                                                marginBottom: '4px'
                                            }}>
                                                Original:
                                            </div>
                                            <div className="review-content" style={{
                                                padding: '10px',
                                                backgroundColor: '#1a1a2e',
                                                borderRadius: '6px',
                                                lineHeight: '1.7'
                                            }}>
                                                {renderContent(node.content)}
                                            </div>
                                        </div>

                                        {/* Translation (editable) */}
                                        <div style={{ marginBottom: '12px' }}>
                                            <div style={{
                                                fontSize: '11px',
                                                color: '#888',
                                                marginBottom: '4px'
                                            }}>
                                                Translation:
                                            </div>
                                            {editingNodeId === node.id ? (
                                                <div>
                                                    <textarea
                                                        className="review-textarea"
                                                        value={editText}
                                                        onChange={(e) => setEditText(e.target.value)}
                                                        style={{
                                                            width: '100%',
                                                            minHeight: '100px',
                                                            padding: '12px',
                                                            backgroundColor: '#1a1a2e',
                                                            border: '1px solid #8b5cf6',
                                                            borderRadius: '6px',
                                                            color: '#e0e0e0',
                                                            outline: 'none',
                                                            resize: 'vertical'
                                                        }}
                                                    />
                                                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                                                        <button
                                                            onClick={() => handleEditSubmit(node.id)}
                                                            disabled={loading}
                                                            style={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '4px',
                                                                padding: '6px 12px',
                                                                backgroundColor: '#22c55e',
                                                                color: 'white',
                                                                border: 'none',
                                                                borderRadius: '4px',
                                                                cursor: 'pointer',
                                                                fontSize: '12px'
                                                            }}
                                                        >
                                                            <Check size={14} />
                                                            Save
                                                        </button>
                                                        <button
                                                            onClick={cancelEdit}
                                                            style={{
                                                                padding: '6px 12px',
                                                                backgroundColor: '#444',
                                                                color: '#e0e0e0',
                                                                border: 'none',
                                                                borderRadius: '4px',
                                                                cursor: 'pointer',
                                                                fontSize: '12px'
                                                            }}
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="review-content" style={{
                                                    padding: '12px',
                                                    backgroundColor: '#1a1a2e',
                                                    borderRadius: '6px',
                                                    lineHeight: '1.7',
                                                    color: node.translation ? '#e0e0e0' : '#666',
                                                    fontStyle: node.translation ? 'normal' : 'italic'
                                                }}>
                                                    {renderContent(node.translation, 'No translation yet')}
                                                </div>
                                            )}
                                        </div>

                                        {/* Actions */}
                                        {editingNodeId !== node.id && (
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button
                                                    onClick={() => handleApprove(node.id)}
                                                    disabled={loading || !node.translation}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '4px',
                                                        padding: '6px 12px',
                                                        backgroundColor: node.translation ? '#22c55e' : '#444',
                                                        color: 'white',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        cursor: node.translation ? 'pointer' : 'not-allowed',
                                                        fontSize: '12px',
                                                        opacity: node.translation ? 1 : 0.5
                                                    }}
                                                >
                                                    <Check size={14} />
                                                    Approve
                                                </button>
                                                <button
                                                    onClick={() => startEdit(node)}
                                                    disabled={loading}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '4px',
                                                        padding: '6px 12px',
                                                        backgroundColor: '#8b5cf6',
                                                        color: 'white',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        cursor: 'pointer',
                                                        fontSize: '12px'
                                                    }}
                                                >
                                                    <Edit2 size={14} />
                                                    Edit
                                                </button>
                                                <button
                                                    onClick={() => handleRetranslate(node.id)}
                                                    disabled={loading}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '4px',
                                                        padding: '6px 12px',
                                                        backgroundColor: '#f59e0b',
                                                        color: 'white',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        cursor: 'pointer',
                                                        fontSize: '12px'
                                                    }}
                                                >
                                                    <RotateCcw size={14} />
                                                    Retranslate
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
