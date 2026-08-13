/** Loading / empty / error states. Every dynamically populated region has all three. */
import type { ReactNode } from "react";

export function LoadingState({
  children,
  ...rest
}: { children: ReactNode } & React.HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div className="state state--loading" role="status" {...rest}>
      {children}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }): JSX.Element {
  return (
    <div className="state state--empty">
      <div className="state__title">{title}</div>
      {children && <div className="state__body">{children}</div>}
    </div>
  );
}

export function ErrorNotice({
  title,
  children,
  onRetry,
  retryLabel = "Retry",
  ...rest
}: {
  title: string;
  children?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
} & React.HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div className="notice notice--error" {...rest}>
      <div className="notice__title">{title}</div>
      <div className="notice__body">
        {children}{" "}
        {onRetry && (
          <button className="btn--link" type="button" data-role="retry-button" onClick={onRetry}>
            {retryLabel}
          </button>
        )}
      </div>
    </div>
  );
}

export function Meter({ fillPct, tall = false }: { fillPct: number; tall?: boolean }): JSX.Element {
  const width = `${Math.max(0, Math.min(100, fillPct))}%`;
  return (
    <div className={tall ? "meter meter--tall" : "meter"} data-role="completion-meter">
      <div className="meter__fill" style={{ width }} data-role="completion-fill" />
      <div className="meter__gap" data-role="completion-gap" />
    </div>
  );
}
