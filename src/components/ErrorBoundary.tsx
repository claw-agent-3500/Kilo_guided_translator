import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

export default class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('[ErrorBoundary] Caught:', error, errorInfo);
        this.setState({ errorInfo });
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null, errorInfo: null });
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) return this.props.fallback;

            return (
                <div className="bg-red-50 border-2 border-red-200 rounded-xl p-8 m-4 text-center">
                    <div className="flex justify-center mb-4">
                        <div className="bg-red-100 p-3 rounded-full">
                            <AlertTriangle className="w-8 h-8 text-red-600" />
                        </div>
                    </div>
                    <h2 className="text-xl font-bold text-red-800 mb-2">Something went wrong</h2>
                    <p className="text-red-600 mb-4 text-sm max-w-md mx-auto">
                        {this.state.error?.message || 'An unexpected error occurred'}
                    </p>
                    {this.state.errorInfo && (
                        <details className="text-left mb-4 max-w-lg mx-auto">
                            <summary className="text-xs text-red-500 cursor-pointer font-medium">Technical Details</summary>
                            <pre className="text-xs text-red-400 mt-2 bg-red-100 p-3 rounded-lg overflow-auto max-h-40">
                                {this.state.errorInfo.componentStack}
                            </pre>
                        </details>
                    )}
                    <button
                        onClick={this.handleReset}
                        className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium flex items-center gap-2 mx-auto"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Try Again
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
