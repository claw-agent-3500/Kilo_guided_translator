import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'danger' | 'warning' | 'info';
    onConfirm: () => void;
    onCancel: () => void;
}

export default function ConfirmDialog({
    isOpen,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'danger',
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    if (!isOpen) return null;

    const variantStyles = {
        danger: { icon: 'bg-red-100 text-red-600', button: 'bg-red-600 hover:bg-red-700' },
        warning: { icon: 'bg-amber-100 text-amber-600', button: 'bg-amber-600 hover:bg-amber-700' },
        info: { icon: 'bg-blue-100 text-blue-600', button: 'bg-blue-600 hover:bg-blue-700' },
    };

    const styles = variantStyles[variant];

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6 animate-in fade-in zoom-in duration-150">
                <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${styles.icon}`}>
                            <AlertTriangle className="w-5 h-5" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900">{title}</h3>
                    </div>
                    <button onClick={onCancel} className="text-slate-400 hover:text-slate-600">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <p className="text-slate-600 text-sm mb-6 leading-relaxed">{message}</p>

                <div className="flex gap-3">
                    <button
                        onClick={onCancel}
                        className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors font-medium"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`flex-1 px-4 py-2 text-white rounded-lg transition-colors font-medium shadow-md ${styles.button}`}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
