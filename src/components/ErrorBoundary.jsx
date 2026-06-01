import { Component } from 'react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex items-center justify-center min-h-[200px]">
          <div className="bg-card border border-danger/30 rounded-lg p-6 max-w-md w-full">
            <p className="text-danger font-sans font-semibold mb-1">Something went wrong</p>
            <p className="text-muted text-sm font-mono">{this.state.error.message}</p>
            <button
              className="mt-4 text-sm text-accent hover:text-accent/80 transition-colors"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
