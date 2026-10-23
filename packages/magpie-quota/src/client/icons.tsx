import React from 'react';

/** Small, local vector marks: no external icon requests or account images. */
export function ProviderIcon({ provider = '', size = 14 }: { provider?: string; size?: number }) {
  const id = provider.toLowerCase().split('/').at(-1) || '';
  let glyph: React.ReactNode;
  if (/codex|openai|chatgpt/.test(id)) glyph = <>{Array.from({ length: 6 }, (_, i) => <path key={i} transform={`rotate(${i * 60} 12 12)`} d="M12 3.8c3-1.7 6.5.4 6.5 3.9v5.6L14 16l-4.4-2.6V8.2L14 5.6" />)}</>;
  else if (/claude|anthropic/.test(id)) glyph = <>{Array.from({ length: 12 }, (_, i) => <path key={i} transform={`rotate(${i * 30} 12 12)`} d={`M12 ${i % 2 ? 2.5 : 3.8}v${i % 2 ? 5.5 : 4.2}`} />)}<circle cx="12" cy="12" r="2.2" /></>;
  else if (/gemini|antigravity|google/.test(id)) glyph = <path d="M12 2c.9 6 4 9.1 10 10-6 .9-9.1 4-10 10-.9-6-4-9.1-10-10 6-.9 9.1-4 10-10Z" />;
  else if (/grok|xai/.test(id)) glyph = <><path d="m4 20 16-16M6 7a8 8 0 0 1 12 10M4.1 10.2A8 8 0 0 0 14 19.7M9 15l7-2 4-9" /></>;
  else if (/copilot|github/.test(id)) glyph = <><path d="M4 11V8a8 8 0 0 1 16 0v3M4 12v7a19 19 0 0 0 16 0v-7M8 17v3m8-3v3" /><rect x="2" y="6" width="8" height="7" rx="3" /><rect x="14" y="6" width="8" height="7" rx="3" /></>;
  else if (/magpie|quota/.test(id)) glyph = <><path d="M4 18a10 10 0 1 1 16 0M12 12l5-6M7 21h10" /><circle cx="12" cy="12" r="1.5" /></>;
  else glyph = <><rect x="4" y="7" width="16" height="13" rx="3" /><path d="M12 3v4M2 11v5m20-5v5M8 16h8" /><circle cx="8" cy="12" r=".6" /><circle cx="16" cy="12" r=".6" /></>;
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{glyph}</svg>;
}
export function RefreshIcon() { return <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 7a6.5 6.5 0 1 0 .3 5M16 3v4h-4" /></svg>; }
