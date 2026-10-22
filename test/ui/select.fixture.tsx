import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import * as ReactDOM from 'react-dom';
import * as JSXRuntime from 'react/jsx-runtime';
import { Select } from '../../src/client/select.js';

declare const __CODEX_CLIENT_SOURCE__: string;
let CodexSettingsPage: React.FC<any> | undefined;
if (__CODEX_CLIENT_SOURCE__) {
  const primitives: Record<string, unknown> = { ConnectionIndicator: () => null };
  for (const [, name] of __CODEX_CLIENT_SOURCE__.matchAll(/hostIcon\("([^"]+)"/g)) primitives[name] = () => null;
  const modules: Record<string, unknown> = { react: React, 'react-dom': ReactDOM, 'react/jsx-runtime': JSXRuntime, '@deepseek-ai/dsh-client-ui-primitives': primitives };
  // The installed bundle remains untouched; expose its component only in this isolated test.
  new Function('loader', __CODEX_CLIENT_SOURCE__.replace('window.__ModuleLoader__', 'loader'))({
    load: ({ factory }: { factory: (require: (name: string) => unknown) => { __TestSettingsPage: React.FC<any> } }) => {
      CodexSettingsPage = factory(name => {
        if (!(name in modules)) throw new Error(`Unexpected Codex test dependency: ${name}`);
        return modules[name];
      }).__TestSettingsPage;
    }
  });
}
const rows = [{ id: 'claude-ssh', label: 'Claude SSH', order: 65 }];
const steps: never[] = [];
const sections = { subscribe: () => () => {}, getSnapshot: () => rows };
const onboarding = { subscribe: () => () => {}, getSnapshot: () => steps };
const connectionState = { subscribe: () => () => {}, getSnapshot: () => 'connected' };


const options = ['alpha-ssh', 'beta-ssh', 'gamma-ssh'].map(value => ({ value, label: value }));
function Picker({ id }: { id: string }) {
  const [value, setValue] = useState('');
  return <section id={id} style={{ padding: 24 }}><label>SSH connection<Select aria-label="SSH connection" kind="ssh" searchable placeholder="Choose SSH connection" value={value} onValueChange={setValue} options={options} style={{ width: 360 }} /></label><output id={`${id}-value`}>{value}</output><button id={`${id}-outside`} style={{ position: 'absolute', right: 24, bottom: 24 }}>Outside the picker</button></section>;
}
function ModalPicker() {
  const dialog = useRef<HTMLDialogElement>(null);
  return <><button id="open-modal" onClick={() => dialog.current?.showModal()}>Open modal settings</button>
    <dialog ref={dialog} aria-label="Modal settings" style={{ width: 600, height: 400, overflow: 'hidden', transform: 'translate(30px, 12px)', background: '#222', color: '#eee' }}>
      <Picker id="modal-picker" /><button id="close-modal" onClick={() => dialog.current?.close()}>Close modal</button>
    </dialog></>;
}
function Fixture() {
  const [frameDoc, setFrameDoc] = useState<Document>();
  return <main><p>UI regression fixture only — no SSH connections or model calls.</p><Picker id="main-picker" />
    <iframe id="settings-frame" title="Separate settings document" style={{ width: 720, height: 480, border: 0 }} srcDoc={'<!doctype html><html><head><style>body{margin:0;font:14px system-ui;background:#222;color:#eee}label{display:grid;gap:8px}output{display:block;min-height:24px}</style></head><body></body></html>'} onLoad={event => setFrameDoc(event.currentTarget.contentDocument ?? undefined)} />
    {frameDoc && createPortal(<Picker id="frame-picker" />, frameDoc.body)}
    <ModalPicker />
    {CodexSettingsPage && <CodexSettingsPage wide sections={sections} onboarding={onboarding} connectionState={connectionState} reconnect={() => {}} useSessions={(select: (state: unknown) => unknown) => select({ phase: 'loading' })} t={(key: string) => key} renderSlot={(name: string) => name === 'settings.trigger' ? 'Open Codex settings' : name === 'settings.section' ? <Picker id="codex-picker" /> : null} />}
  </main>;
}
const root = document.createElement('div'); document.body.append(root); createRoot(root).render(<Fixture />);
