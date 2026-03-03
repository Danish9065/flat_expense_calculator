import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
    children?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
    };

    public static getDerivedStateFromError(error: Error): State {
        // Update state so the next render will show the fallback UI.
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error:', error, errorInfo);
    }

    private handleReload = () => {
        window.location.reload();
    };

    public render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen bg-gray-50 flex flex-col justify-center items-center p-4">
                    <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center border border-gray-100">
                        <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
                            <AlertCircle className="w-8 h-8" />
                        </div>
                        <h1 className="text-2xl font-black text-gray-900 mb-2">Something went wrong</h1>
                        <p className="text-gray-500 mb-6 text-sm">
                            We encountered an unexpected error. Please try reloading the application.
                        </p>

                        <div className="bg-gray-50 rounded-lg p-3 text-left mb-6 overflow-x-auto border border-gray-200">
                            <code className="text-xs text-red-600 font-mono">
                                {this.state.error?.message || 'Unknown Error'}
                            </code>
                        </div>

                        <button
                            onClick={this.handleReload}
                            className="w-full flex justify-center items-center px-4 py-3 bg-gray-900 text-white font-bold rounded-xl hover:bg-gray-800 transition-colors"
                        >
                            <RefreshCw className="w-4 h-4 mr-2" />
                            Reload App
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
