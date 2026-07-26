import { Component, type ReactNode } from 'react';
import { ErrorFallback } from '@renderer/components/ErrorBoundary/components/ErrorFallback';
import { logError } from '@renderer/lib/logError';

export interface ErrorBoundaryProps {
  children: ReactNode;
}

type ErrorBoundaryState = { hasError: false } | { hasError: true; message: string };

const INITIAL_STATE: ErrorBoundaryState = { hasError: false };

const ERROR_BOUNDARY_CONTEXT = 'ErrorBoundary';

function describeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A class, deliberately: `getDerivedStateFromError` and `componentDidCatch` have no
 * hook equivalent in React 19, so this is the one component in the app that cannot
 * be a function. Do not "fix" it.
 *
 * Without it an uncaught render error unmounts the tree and leaves a blank window
 * with no way back — the run still finishing in main becomes invisible and
 * unreviewable. The error is logged rather than swallowed, through the same
 * `logError` as every other renderer failure.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = INITIAL_STATE;

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { hasError: true, message: describeMessage(error) };
  }

  componentDidCatch(error: unknown): void {
    logError(error, ERROR_BOUNDARY_CONTEXT);
  }

  /**
   * A full reload rather than clearing the flag: the render threw on state this
   * boundary has no way to repair, and everything durable lives in main, so the
   * reload costs a re-query rather than any work.
   */
  private readonly onReloadClick = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const state = this.state;
    if (!state.hasError) return this.props.children;

    return <ErrorFallback message={state.message} onReloadClick={this.onReloadClick} />;
  }
}
