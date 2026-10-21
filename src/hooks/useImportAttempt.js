import { useEffect, useRef, useState } from 'react';
import { describeImportError } from '../lib/importErrors';

// A response belongs to exactly one attempt. A retry or input change invalidates
// the old request, even if that request finishes after the replacement request.
export function useImportAttempt() {
  const current = useRef(null);
  const sequence = useRef(0);
  const [feedback, setFeedback] = useState(null);
  useEffect(() => () => current.current?.controller.abort(), []);

  const clear = () => {
    current.current?.controller.abort();
    current.current = null;
    setFeedback(null);
  };
  const begin = (action) => {
    current.current?.controller.abort();
    const attempt = { number: ++sequence.current, action, startedAt: new Date().toISOString(), controller: new AbortController() };
    current.current = attempt;
    setFeedback({ ...attempt, status: 'pending', message: `${action}…` });
    return attempt;
  };
  const isCurrent = (attempt) => current.current === attempt && !attempt.controller.signal.aborted;
  const finish = (attempt, message, status = 'success') => {
    if (isCurrent(attempt)) setFeedback({ ...attempt, status, message, finishedAt: new Date().toISOString() });
  };
  const fail = (attempt, error) => {
    if (isCurrent(attempt)) setFeedback({ ...attempt, status: 'error', ...describeImportError(error), finishedAt: new Date().toISOString() });
  };
  return { feedback, begin, finish, fail, clear, isCurrent };
}
