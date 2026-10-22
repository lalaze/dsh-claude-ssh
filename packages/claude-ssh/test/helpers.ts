import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Ssh, type Spawn } from '../src/ssh.js';
import { Store } from '../src/store.js';
import { revision, type Host, type Binding } from '../src/domain.js';

/** Real POSIX script + zsh execution, with the SSH carrier replaced by a local shell. No real Claude. */
export const shellTransport: Spawn = (_file, args) => existsSync('/bin/zsh')
  ? spawn('/bin/zsh', ['-f', '-c', args.at(-1)!], { stdio: ['pipe', 'pipe', 'pipe'] })
  : spawn('/bin/sh', ['-c', args.at(-1)!], { stdio: ['pipe', 'pipe', 'pipe'] });
export async function fixture(mode = 'success') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-ssh-test-')));
  const path = join(root, "项目 空格 'quote' $x;dir");
  await mkdir(path);
  const binary = join(root, 'claude fixture');
  const source = `#!/usr/bin/env node
const mode = ${JSON.stringify(mode)};
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('2.1.fixture'); process.exit(0); }
if (args.includes('--help')) { console.log('--input-format --output-format --permission-prompt-tool --include-partial-messages --session-id --resume'); process.exit(0); }
if (args[0] === 'auth') { console.log(JSON.stringify({loggedIn: mode !== 'logout'})); process.exit(mode === 'logout' ? 1 : 0); }
const rl = require('node:readline').createInterface({input:process.stdin});
const session = args[args.indexOf(args.includes('--resume') ? '--resume' : '--session-id') + 1];
const emit = x => process.stdout.write(JSON.stringify(x) + '\\n');
let sent = false;
rl.on('line', raw => {
  const f = JSON.parse(raw);
  if (f.type === 'user' && !sent) {
    sent = true;
    emit({type:'system',subtype:'init',session_id:session});
    if (mode === 'disconnect') { process.stderr.write('Connection reset by peer'); process.exit(255); }
    if (mode === 'hang') return;
    if (mode === 'permission') { emit({type:'control_request',request_id:'req-1',request:{subtype:'can_use_tool',tool_name:'Bash',tool_use_id:'tool-1',input:{command:'pwd'}}}); return; }
    if (mode === 'unknown') { emit({type:'control_request',request_id:'unknown-1',request:{subtype:'elicitation'}}); return; }
    emit({type:'stream_event',event:{type:'message_start'}});
    emit({type:'stream_event',event:{type:'content_block_start',index:0,content_block:{type:'text',text:''}}});
    emit({type:'stream_event',event:{type:'content_block_delta',index:0,delta:{type:'text_delta',text:process.cwd()}}});
    emit({type:'stream_event',event:{type:'content_block_stop',index:0}});
    emit({type:'assistant',message:{content:[{type:'text',text:process.cwd()},{type:'tool_use',id:'t1',name:'Read',input:{file_path:'README.md'}}]}});
    emit({type:'user',message:{content:[{type:'tool_result',tool_use_id:'t1',content:'真实夹具结果'}]}});
    emit({type:'result',subtype:'success',session_id:session,usage:{input_tokens:2,output_tokens:3}});
  }
  if (f.type === 'control_response') {
    emit({type:'assistant',message:{content:[{type:'text',text:JSON.stringify(f.response)}]}});
    emit({type:'result',subtype:'success',session_id:session});
  }
  if (f.type === 'control_request' && f.request.subtype === 'interrupt') {
    require('node:fs').writeFileSync(${JSON.stringify(join(root, 'interrupted'))}, 'yes');
    emit({type:'result',subtype:'error_during_execution',is_error:true,session_id:session});
  }
});
`;
  await writeFile(binary, source, { mode: 0o700 });
  const host: Host = { id: 'self', name: '夹具', destination: 'fixture', claudePath: binary };
  const binding: Binding = { sessionId: randomUUID(), workspaceId: randomUUID(), hostId: host.id, hostRevision: revision(host), path, user: userInfo().username, claudeSessionId: randomUUID(), initialized: false, state: 'ready' };
  const store = new Store(join(root, 'state.json')); await store.load();
  await store.update(s => { s.hosts.push(host); s.workspaces.push({ id: binding.workspaceId, hostId: host.id, hostRevision: binding.hostRevision, path, user: binding.user }); s.bindings[binding.sessionId] = binding; });
  return { root, path, binary, host, binding, store, ssh: new Ssh(shellTransport), dispose: () => rm(root, { recursive: true, force: true }) };
}
export async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> { const result: T[] = []; for await (const v of iter) result.push(v); return result; }
