import { useId, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Button } from '../../shared/ui/Button';
import { VisuallyHidden } from '../../shared/ui/VisuallyHidden';
import { detectIdCandidate } from './idDetection';
import type { DetectableIdField } from './idDetection';
import styles from './UniversalSearch.module.css';

export const UNIVERSAL_SEARCH_LABEL = 'Search messages, errors, users or paste an ID';

export interface UniversalSearchProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  onApplyDetectedField: (field: DetectableIdField, value: string) => void;
}

/**
 * Universal search (IMPLEMENTATION_PLAN.md "Phase F" scope item 5).
 * Defaults to a plain message-text search - "message + error code" means
 * both are the kind of thing that naturally surfaces via ordinary message
 * text matching (an error code embedded in a log message), not a second
 * structured field silently ANDed in alongside it (which the backend's
 * structured filters, all ANDed together, would make far too narrow).
 */
export function UniversalSearch({ value, onChange, onSubmit, onApplyDetectedField }: UniversalSearchProps) {
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  const inputId = useId();

  const detected = suggestionDismissed ? null : detectIdCandidate(value);

  function handleChange(next: string) {
    onChange(next);
    setSuggestionDismissed(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      onSubmit();
      return;
    }
    if (event.key === 'Escape' && detected) {
      // "Escape closes suggestions without destructive clearing" - the
      // typed text itself is untouched.
      event.stopPropagation();
      setSuggestionDismissed(true);
    }
  }

  function confirmDetected() {
    if (!detected) {
      return;
    }
    onApplyDetectedField(detected.field, value.trim());
    onChange('');
    setSuggestionDismissed(false);
  }

  return (
    <div className={styles.wrapper}>
      <label htmlFor={inputId}>
        <VisuallyHidden>{UNIVERSAL_SEARCH_LABEL}</VisuallyHidden>
      </label>
      <input
        id={inputId}
        className={styles.input}
        type="text"
        placeholder={UNIVERSAL_SEARCH_LABEL}
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        onKeyDown={handleKeyDown}
        aria-describedby={detected ? `${inputId}-suggestion` : undefined}
        data-shortcut="universal-search"
      />
      {detected ? (
        <div id={`${inputId}-suggestion`} className={styles.suggestion} role="status">
          <span className={styles.suggestionText}>
            This looks like a {detected.fieldLabel}. Search as {detected.fieldLabel} instead?
          </span>
          <div className={styles.suggestionActions}>
            <Button variant="primary" onClick={confirmDetected}>
              Search as {detected.fieldLabel}
            </Button>
            <Button variant="ghost" aria-label="Dismiss suggestion" onClick={() => setSuggestionDismissed(true)}>
              ✕
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
