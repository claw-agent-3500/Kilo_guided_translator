import { useState, useEffect } from 'react';
import { Key, Plus, Trash2, X, Check, Eye, EyeOff, Zap, DollarSign } from 'lucide-react';

interface ApiKeyConfig {
    key: string;
    isPaid: boolean;
}

interface ApiKeyManagerProps {
    onKeysUpdated: (keys: ApiKeyConfig[]) => void;
    initialKeys?: string[] | ApiKeyConfig[];
    inline?: boolean; // When true, render inline instead of as a modal button
}

// Helper to convert legacy string[] to ApiKeyConfig[]
function normalizeKeys(keys: string[] | ApiKeyConfig[]): ApiKeyConfig[] {
    if (keys.length === 0) return [];
    if (typeof keys[0] === 'string') {
        return (keys as string[]).map(k => ({ key: k, isPaid: false }));
    }
    return keys as ApiKeyConfig[];
}

export default function ApiKeyManager({ onKeysUpdated, initialKeys = [], inline = false }: ApiKeyManagerProps) {
    const [keys, setKeys] = useState<ApiKeyConfig[]>(normalizeKeys(initialKeys));
    const [newKey, setNewKey] = useState('');
    const [newKeyIsPaid, setNewKeyIsPaid] = useState(false);
    const [isOpen, setIsOpen] = useState(inline); // Auto-open in inline mode
    const [showKey, setShowKey] = useState(false);

    useEffect(() => {
        setKeys(normalizeKeys(initialKeys));
    }, [initialKeys]);

    const handleAddKey = () => {
        if (newKey.trim() && !keys.some(k => k.key === newKey.trim())) {
            const updatedKeys = [...keys, { key: newKey.trim(), isPaid: newKeyIsPaid }];
            setKeys(updatedKeys);
            onKeysUpdated(updatedKeys);
            setNewKey('');
            setNewKeyIsPaid(false);
        }
    };

    const handleRemoveKey = (index: number) => {
        const updatedKeys = keys.filter((_, i) => i !== index);
        setKeys(updatedKeys);
        onKeysUpdated(updatedKeys);
    };

    const handleTogglePaid = (index: number) => {
        const updatedKeys = keys.map((k, i) =>
            i === index ? { ...k, isPaid: !k.isPaid } : k
        );
        setKeys(updatedKeys);
        onKeysUpdated(updatedKeys);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleAddKey();
        }
    };

    const paidCount = keys.filter(k => k.isPaid).length;
    const freeCount = keys.length - paidCount;

    // Inline mode: render just the input + add button (no modal wrapper)
    if (inline) {
        return (
            <div className="flex gap-2 items-center">
                <div className="relative flex-1 max-w-md">
                    <input
                        type={showKey ? "text" : "password"}
                        value={newKey}
                        onChange={(e) => setNewKey(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Paste your Gemini API key here..."
                        className="w-full px-4 py-3 border-2 border-amber-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none pr-10 text-sm"
                    />
                    <button
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                        {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                </div>
                <button
                    onClick={handleAddKey}
                    disabled={!newKey.trim()}
                    className="bg-amber-600 text-white px-5 py-3 rounded-xl hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold text-sm"
                >
                    Add Key
                </button>
            </div>
        );
    }

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors relative"
                title="Manage API Keys"
            >
                <Key className="w-5 h-5" />
                {paidCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                        $
                    </span>
                )}
            </button>
        );
    }

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-lg animate-in fade-in zoom-in duration-200">
                <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center gap-2 text-slate-800">
                        <div className="bg-blue-100 p-2 rounded-lg">
                            <Key className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold">API Key Manager</h2>
                            <p className="text-xs text-slate-500">
                                {keys.length} key{keys.length !== 1 ? 's' : ''} configured
                                {paidCount > 0 && <span className="text-amber-600 ml-1">({paidCount} paid)</span>}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => setIsOpen(false)}
                        className="text-slate-400 hover:text-slate-600 transition-colors"
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="space-y-4">
                    {/* Info Box */}
                    <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-4 rounded-lg text-sm border border-blue-100">
                        <div className="flex items-start gap-2">
                            <Zap className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
                            <div className="text-slate-600">
                                <p className="font-medium text-slate-700 mb-1">Rate Limit Guide:</p>
                                <ul className="text-xs space-y-1">
                                    <li><span className="text-slate-500">Free tier:</span> 15 requests/min, 1,500/day</li>
                                    <li><span className="text-amber-600 font-medium">Paid tier:</span> Much higher limits, faster translation</li>
                                </ul>
                            </div>
                        </div>
                    </div>

                    {/* Key List */}
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                        {keys.map((keyConfig, index) => (
                            <div key={index} className={`flex items-center gap-2 p-3 rounded-lg group border ${keyConfig.isPaid
                                    ? 'bg-amber-50 border-amber-200'
                                    : 'bg-white border-slate-200'
                                }`}>
                                <div className={`p-1.5 rounded-md ${keyConfig.isPaid ? 'bg-amber-100' : 'bg-emerald-100'
                                    }`}>
                                    {keyConfig.isPaid
                                        ? <DollarSign className="w-3 h-3 text-amber-600" />
                                        : <Check className="w-3 h-3 text-emerald-600" />
                                    }
                                </div>
                                <code className="flex-1 text-sm font-mono text-slate-600">
                                    {keyConfig.key.slice(0, 6)}...{keyConfig.key.slice(-4)}
                                </code>

                                {/* Paid Toggle */}
                                <button
                                    onClick={() => handleTogglePaid(index)}
                                    className={`px-2 py-1 text-xs font-medium rounded-full transition-all ${keyConfig.isPaid
                                            ? 'bg-amber-500 text-white'
                                            : 'bg-slate-100 text-slate-500 hover:bg-amber-100 hover:text-amber-600'
                                        }`}
                                    title={keyConfig.isPaid ? 'Paid API Key' : 'Click to mark as Paid'}
                                >
                                    {keyConfig.isPaid ? 'Paid' : 'Free'}
                                </button>

                                <button
                                    onClick={() => handleRemoveKey(index)}
                                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md opacity-0 group-hover:opacity-100 transition-all"
                                    title="Remove Key"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        ))}

                        {keys.length === 0 && (
                            <div className="text-center py-6 text-slate-400 text-sm">
                                No API keys configured. Add one below.
                            </div>
                        )}
                    </div>

                    {/* Add New Key */}
                    <div className="pt-2 border-t border-slate-100">
                        <p className="text-xs text-slate-500 mb-2">Add new API key:</p>
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <input
                                    type={showKey ? "text" : "password"}
                                    value={newKey}
                                    onChange={(e) => setNewKey(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Enter Gemini API Key..."
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none pr-10"
                                />
                                <button
                                    onClick={() => setShowKey(!showKey)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                >
                                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>

                            {/* Paid Toggle for New Key */}
                            <button
                                onClick={() => setNewKeyIsPaid(!newKeyIsPaid)}
                                className={`px-3 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-1 ${newKeyIsPaid
                                        ? 'bg-amber-500 text-white'
                                        : 'bg-slate-100 text-slate-600 hover:bg-amber-100 hover:text-amber-600'
                                    }`}
                                title="Toggle Paid/Free"
                            >
                                <DollarSign className="w-4 h-4" />
                                {newKeyIsPaid ? 'Paid' : 'Free'}
                            </button>

                            <button
                                onClick={handleAddKey}
                                disabled={!newKey.trim()}
                                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                <Plus className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                </div>

                <div className="mt-6 pt-4 border-t flex justify-between items-center">
                    <div className="text-xs text-slate-500">
                        {freeCount > 0 && <span className="text-emerald-600">{freeCount} Free</span>}
                        {freeCount > 0 && paidCount > 0 && <span> · </span>}
                        {paidCount > 0 && <span className="text-amber-600">{paidCount} Paid</span>}
                    </div>
                    <button
                        onClick={() => setIsOpen(false)}
                        className="px-4 py-2 bg-slate-100 text-slate-700 font-medium rounded-lg hover:bg-slate-200 transition-colors"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
}

