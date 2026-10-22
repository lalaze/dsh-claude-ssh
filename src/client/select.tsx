import React from 'react';

// Keep the native keyboard/menu behavior, with one themed arrow on every platform.
export function Select({ style, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>): React.ReactElement {
  return <span style={{ display: 'inline-flex', position: 'relative', width: style?.width, minWidth: 0, verticalAlign: 'middle' }}>
    <select {...props} style={{ ...style, width: '100%', appearance: 'none', WebkitAppearance: 'none', backgroundImage: 'none', paddingRight: 34 }}>{children}</select>
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, pointerEvents: 'none', color: 'inherit', opacity: props.disabled ? 0.4 : 0.7 }}>
      <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </span>;
}
