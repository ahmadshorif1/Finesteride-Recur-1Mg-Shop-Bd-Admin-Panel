import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || 'Unexpected runtime error occurred.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Admin Panel ErrorBoundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      let parsedOperation: string | null = null;
      let parsedPath: string | null = null;
      let displayError = this.state.errorMessage;
      try {
        const parsed = JSON.parse(this.state.errorMessage);
        if (parsed && typeof parsed === 'object' && 'error' in parsed) {
          displayError = String(parsed.error);
          parsedOperation = parsed.operationType ? String(parsed.operationType) : null;
          parsedPath = parsed.path ? String(parsed.path) : null;
        }
      } catch {
        // Plain error message
      }

      return (
        <div className="min-h-screen bg-[#F4F7F8] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-[#E6ECEF] rounded-2xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-[#DC2626] shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h1 className="text-lg font-semibold text-[#0F172A]">
                  Application Operation Interrupted
                </h1>
                <p className="text-sm text-[#64748B] leading-relaxed">{displayError}</p>
                {(parsedOperation || parsedPath) && (
                  <p className="text-xs font-mono text-[#64748B] pt-1">
                    {parsedOperation ? `Operation: ${parsedOperation}` : ''}
                    {parsedOperation && parsedPath ? ' · ' : ''}
                    {parsedPath ? `Path: ${parsedPath}` : ''}
                  </p>
                )}
              </div>
            </div>
            <div className="pt-2 border-t border-[#EEF2F6] flex justify-end">
              <button
                type="button"
                onClick={() => {
                  this.setState({ hasError: false, errorMessage: '' });
                  window.location.reload();
                }}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0D7E74] hover:bg-[#09635B] rounded-xl transition-colors whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-4 h-4" />
                Reload Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
