/**
 * The screen a user sees when a part of the app throws while rendering.
 *
 * React unmounts the whole tree below a throwing component, so without a
 * boundary one bad render is a blank white page — and, because the vault is
 * zero-knowledge, we would never hear about it. This boundary does three
 * things: reports the crash (with no planner content), offers the user a way
 * out that does not lose their data, and shows them a short id they can quote
 * if they write in.
 *
 * It is deliberately plain: no hooks, no context, no data access. A boundary
 * that can itself fail is not much of a boundary.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../i18n';
import { redactText, reportError } from '../reporting';

interface Props {
  /** Which part of the app this guards — it goes on the report. */
  area: string;
  children: ReactNode;
  /**
   * Where "start over" should send the user. Defaults to the app root, which
   * reopens the vault from the local copy.
   */
  homeHref?: string;
}

interface State {
  error: Error | null;
  reportId: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, reportId: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const reportId = reportError(error, {
      area: this.props.area,
      action: 'render',
      componentStack: info.componentStack ?? undefined,
    });
    // Never a second render from the catch: setState here is safe because the
    // tree is already in its error state.
    this.setState({ reportId });
  }

  private retry = (): void => {
    this.setState({ error: null, reportId: null });
  };

  render(): ReactNode {
    const { error, reportId } = this.state;
    if (!error) return this.props.children;

    const homeHref = this.props.homeHref ?? '/app';
    return (
      <div className="error-screen" role="alert">
        <div className="error-card">
          <p className="error-kicker">{t('Planner')}</p>
          <h1 className="error-title">{t('This part of Planner stopped working.')}</h1>
          <p className="error-body">
            {t('Nothing was lost — your planner is still saved on this device. Try again, or reload the app.')}
          </p>
          <p className="error-detail">{t('What went wrong: {message}', { message: redactText(error.message || error.name, 160) })}</p>
          <div className="error-actions">
            <button type="button" className="btn btn-primary" onClick={this.retry}>
              {t('Try again')}
            </button>
            <button type="button" className="btn btn-soft" onClick={() => window.location.assign(homeHref)}>
              {t('Reload the app')}
            </button>
          </div>
          {reportId ? <p className="error-id">{t('Reference: {id}', { id: reportId })}</p> : null}
        </div>
      </div>
    );
  }
}
