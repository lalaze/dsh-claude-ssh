import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { Select } from '../../src/client/select.js';

const options = ['alpha-ssh', 'beta-ssh', 'gamma-ssh'].map(value => ({ value, label: value }));
function Picker({ id }: { id: string }) {
  const [value, setValue] = useState('');
  return <section id={id} style={{ padding: 24 }}><label>SSH connection<Select aria-label="SSH connection" kind="ssh" searchable placeholder="Choose SSH connection" value={value} onValueChange={setValue} options={options} style={{ width: 360 }} /></label><output id={`${id}-value`}>{value}</output><button id={`${id}-outside`} style={{ position: 'absolute', right: 24, bottom: 24 }}>Outside the picker</button></section>;
}
function Fixture() {
  const [frameDoc, setFrameDoc] = useState<Document>();
  return <main><p>UI regression fixture only — no SSH connections or model calls.</p><Picker id="main-picker" />
    <iframe id="settings-frame" title="Separate settings document" style={{ width: 720, height: 480, border: 0 }} srcDoc={'<!doctype html><html><head><style>body{margin:0;font:14px system-ui;background:#222;color:#eee}label{display:grid;gap:8px}output{display:block;min-height:24px}</style></head><body></body></html>'} onLoad={event => setFrameDoc(event.currentTarget.contentDocument ?? undefined)} />
    {frameDoc && createPortal(<Picker id="frame-picker" />, frameDoc.body)}
  </main>;
}
const root = document.createElement('div'); document.body.append(root); createRoot(root).render(<Fixture />);
