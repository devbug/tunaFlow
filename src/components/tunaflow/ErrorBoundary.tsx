import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary] Caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen w-screen bg-background text-foreground gap-4 p-8">
          <p className="text-[14px] font-medium text-destructive">렌더링 오류가 발생했습니다</p>
          <p className="text-[12px] text-muted-foreground max-w-md text-center">
            {this.state.error?.message ?? "Unknown error"}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-4 py-2 rounded-md text-[12px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
          >
            다시 시도
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-md text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            앱 새로고침
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
