import { useState, useCallback, useRef } from 'react';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';

interface Toast {
    id: number;
    type: 'success' | 'error' | 'info';
    message: string;
}

let toastId = 0;

export function useToast() {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const timeoutRefs = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

    const removeToast = useCallback((id: number) => {
        setToasts(prev => prev.filter(t => t.id !== id));
        const timeout = timeoutRefs.current.get(id);
        if (timeout) {
            clearTimeout(timeout);
            timeoutRefs.current.delete(id);
        }
    }, []);

    const addToast = useCallback((type: Toast['type'], message: string, duration = 4000) => {
        const id = ++toastId;
        setToasts(prev => [...prev, { id, type, message }]);
        if (duration > 0) {
            const timeout = setTimeout(() => removeToast(id), duration);
            timeoutRefs.current.set(id, timeout);
        }
        return id;
    }, [removeToast]);

    const success = useCallback((msg: string) => addToast('success', msg), [addToast]);
    const error = useCallback((msg: string) => addToast('error', msg, 6000), [addToast]);
    const info = useCallback((msg: string) => addToast('info', msg), [addToast]);

    const ToastContainer = useCallback(() => {
        if (toasts.length === 0) return null;

        const iconMap = {
            success: <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />,
            error: <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />,
            info: <Info className="w-5 h-5 text-blue-600 flex-shrink-0" />,
        };

        const bgMap = {
            success: 'bg-emerald-50 border-emerald-200',
            error: 'bg-red-50 border-red-200',
            info: 'bg-blue-50 border-blue-200',
        };

        return (
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 items-center">
                {toasts.map(toast => (
                    <div
                        key={toast.id}
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg animate-in slide-in-from-bottom-2 fade-in duration-200 ${bgMap[toast.type]}`}
                    >
                        {iconMap[toast.type]}
                        <p className="text-sm font-medium text-slate-800">{toast.message}</p>
                        <button
                            onClick={() => removeToast(toast.id)}
                            className="text-slate-400 hover:text-slate-600 ml-2"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                ))}
            </div>
        );
    }, [toasts, removeToast]);

    return { success, error, info, ToastContainer };
}
