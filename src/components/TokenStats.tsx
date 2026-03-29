import { memo } from 'react';

function TokenStats({ usage }: { usage: { input: number; output: number; total: number } }) {
    if (usage.total === 0) return null;

    return (
        <div className="flex items-center gap-4 text-xs font-mono bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
            <div className="flex items-center gap-1.5" title="Input Tokens">
                <span className="text-slate-400">IN</span>
                <span className="font-semibold text-slate-700">{usage.input.toLocaleString()}</span>
            </div>
            <div className="w-px h-3 bg-slate-200" />
            <div className="flex items-center gap-1.5" title="Output Tokens">
                <span className="text-slate-400">OUT</span>
                <span className="font-semibold text-blue-600">{usage.output.toLocaleString()}</span>
            </div>
            <div className="w-px h-3 bg-slate-200" />
            <div className="flex items-center gap-1.5" title="Total Tokens">
                <span className="text-slate-400">TOT</span>
                <span className="font-bold text-slate-900">{usage.total.toLocaleString()}</span>
            </div>
        </div>
    );
}

export default memo(TokenStats);