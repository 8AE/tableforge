import React from 'react';

export function ImportFeedback({ feedback }) {
  if (!feedback) return null;
  const time = feedback.finishedAt || feedback.startedAt;
  return (
    <div key={`${feedback.number}-${feedback.status}`} className={`import-feedback ${feedback.status}`} role={feedback.status === 'error' ? 'alert' : 'status'} aria-live={feedback.status === 'error' ? 'assertive' : 'polite'} aria-atomic="true">
      <div className="import-feedback-heading">
        <strong>{feedback.status === 'pending' ? 'In progress' : feedback.status === 'error' ? 'Attempt failed' : feedback.status === 'warning' ? 'Check import details' : 'Completed'}</strong>
        <span>Attempt {feedback.number} · <time dateTime={time}>{new Date(time).toLocaleTimeString()}</time></span>
      </div>
      <p>{feedback.message}</p>
      {feedback.code && <small>Error code: <strong>{feedback.code}</strong>{feedback.requestId ? ` · Request ${feedback.requestId}` : ''}</small>}
      {feedback.url && <small className="import-feedback-url">Source: {feedback.url}</small>}
    </div>
  );
}
