interface SkeletonProps {
    className?: string;
    variant?: 'text' | 'circular' | 'rectangular';
    width?: string | number;
    height?: string | number;
}

export default function Skeleton({
    className = '',
    variant = 'text',
    width,
    height,
}: SkeletonProps) {
    const baseClasses = 'animate-pulse bg-slate-200';
    const variantClasses = {
        text: 'rounded h-4',
        circular: 'rounded-full',
        rectangular: 'rounded-lg',
    };

    const style: React.CSSProperties = {};
    if (width) style.width = typeof width === 'number' ? `${width}px` : width;
    if (height) style.height = typeof height === 'number' ? `${height}px` : height;

    return (
        <div
            className={`${baseClasses} ${variantClasses[variant]} ${className}`}
            style={style}
        />
    );
}

/** Pre-built skeleton layouts */
Skeleton.Text = ({ lines = 3, className = '' }: { lines?: number; className?: string }) => (
    <div className={`space-y-2 ${className}`}>
        {Array.from({ length: lines }).map((_, i) => (
            <Skeleton
                key={i}
                variant="text"
                className={i === lines - 1 ? 'w-3/4' : 'w-full'}
            />
        ))}
    </div>
);

Skeleton.Card = ({ className = '' }: { className?: string }) => (
    <div className={`p-4 bg-white rounded-xl border border-slate-200 ${className}`}>
        <div className="flex items-center gap-3 mb-4">
            <Skeleton variant="circular" width={40} height={40} />
            <div className="flex-1">
                <Skeleton variant="text" className="w-1/3 mb-2" />
                <Skeleton variant="text" className="w-1/2 h-3" />
            </div>
        </div>
        <Skeleton.Text lines={3} />
    </div>
);

Skeleton.Table = ({ rows = 5, cols = 4, className = '' }: { rows?: number; cols?: number; className?: string }) => (
    <div className={className}>
        {Array.from({ length: rows }).map((_, rowIdx) => (
            <div key={rowIdx} className="flex gap-4 py-3 border-b border-slate-100">
                {Array.from({ length: cols }).map((_, colIdx) => (
                    <Skeleton key={colIdx} variant="text" className={colIdx === 0 ? 'w-1/4' : 'flex-1'} />
                ))}
            </div>
        ))}
    </div>
);
