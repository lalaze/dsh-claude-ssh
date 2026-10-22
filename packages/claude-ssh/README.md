# Claude SSH

**English** | [简体中文](README.zh-CN.md)

`dsh-claude-ssh` is a TypeScript plugin for DeepSeek Harness. Use Claude Code installed and authenticated on another machine through your local DSH Web interface and system OpenSSH.

Claude's agent loop, tools, file operations, and terminal commands run on the SSH target. DSH displays stream-json events and forwards permission decisions, user answers, and cancellation. The target needs neither DSH nor a dedicated background service.

## Installation

The first release targets **DSH 0.2.1-rc.2, Node.js ≥ 22.15, and macOS / Linux**. Its integration uses interfaces inspected in that DSH version; other versions require validation. The target needs OpenSSH, POSIX `/bin/sh`, and Claude Code supporting stream-json, stdio permission requests, `auth status --json`, and session-id/resume. macOS with the default zsh is supported; Linux has not been tested on a real machine.

This plugin lives in `packages/claude-ssh` within the [plugin workspace](../../README.md). Run these commands at the repository root to build and install from source:

```sh
git clone https://github.com/lalaze/dsh-claude-ssh.git
cd dsh-claude-ssh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter dsh-claude-ssh check
corepack pnpm --filter dsh-claude-ssh pack:plugin
dsh plugin --profile web add "$PWD/dist/dsh-claude-ssh-0.1.6.tgz"
```

For **DSH Desktop**, open the application once to initialize its profile, fully quit it, then use `--profile desktop` instead of `--profile web` in the installation command. Reopen the desktop application after installation.

For Web, restart that DSH profile and refresh the browser. **Claude SSH** should appear in Settings. The package includes compiled server code, the client module, and `cordis.patch.yml`; no build is required on the SSH target.

The package is **not published to npm**. Install the generated `.tgz`, optionally copying it to the machine running DSH first. The GitHub root is a private workspace, not an installable plugin package; use the individual archive from `dist/`.

## Upgrading

Fully quit DSH Desktop before installing a new package into `--profile desktop`, then reopen it. Closing only the window may leave the old backend running while updated client files load. For Web, restart the backend of the profile you updated and refresh the browser. The SSH settings show client/server versions and the actual SSH config path. Different patch versions do not block the picker when the backend advertises the SSH list capability; a warning recommends finishing the update. Missing/unsupported APIs still produce an explicit error rather than an empty list.

## Configuration and use

1. Open DSH Settings → **Claude SSH**.
2. Select a connection under **从本机 SSH 配置选择** (Choose from local SSH config), or manually enter an SSH alias / `user@host`. Selecting an alias fills the target and supplies an ID/name for a new blank host. Save the host; optionally specify a port and an absolute Claude executable path.
3. Select **测试连接与 Claude** (Test connection and Claude). This checks the target user, executable, version, authentication, and required CLI options through a real noninteractive SSH connection. It does **not** call a model.
4. Select the saved host, browse or enter an absolute remote directory, and save the remote workspace. Empty directories are allowed. The directory must exist, be readable, and allow entry; `~` is not expanded.
5. Choose `sonnet`, `opus`, or `haiku` for that workspace and create a remote session. These are CLI aliases resolved by the remote Claude installation.
6. Send text in the DSH conversation. The composer continuously shows **host (SSH target) / remote user / actual remote directory**, along with the Claude session ID and state.
7. Answer permission requests and AskUserQuestion prompts in DSH's native dialogs. Permissions are single-use decisions; unavailable, dismissed, or canceled prompts are denied. Claude also applies the target user's existing permission rules.

The plugin sends only previously unsent user text. Local DSH system prompts, tool declarations, and local Claude authentication do not configure remote Claude. The target user's Claude Code reads the project's `CLAUDE.md`, Skills, Hooks, MCP configuration, and existing login. Validate your own Hooks/MCP setup before relying on it. The plugin UI is currently Chinese; this documentation is bilingual.

### SSH setup

First verify SSH under the same operating-system user that runs DSH:

```sh
ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes my-dev-box 'id -un; pwd'
```

The plugin uses system `ssh`, reusing keys, SSH Agent, known_hosts, SSH config, and ProxyJump. It does not store passwords, private keys, or Claude tokens. This release requires noninteractive key/Agent authentication; configure password or interactive MFA requirements at the SSH layer beforehand.

For a new host, verify its fingerprint in a terminal and establish known_hosts first. The plugin always sets `StrictHostKeyChecking=yes` and never automatically trusts new keys. Leave the port field empty to use an alias's configured Port. Write literal IPv6 targets as `[::1]` or `user@[::1]`.

The local machine can also be an SSH target if its SSH service and key authentication are configured. Installing this plugin does not enable SSH or change its configuration. The development machine's authorized loopback setup and removal instructions are recorded in [validation notes](docs/validation.md#本机-ssh-验收配置) (Chinese).

The alias picker reads `~/.ssh/config`, recursive `Include` files, and `/etc/ssh/ssh_config` for the user running DSH. It supports common Include globs, quoted paths, `~`, `%d`, `%%`, and `${VARIABLE}`. The themed picker supports search, selected markers, a scrollable list, arrow keys, Enter, Escape, and Tab. Use **刷新 SSH 列表** (Refresh SSH list) after editing config. Only concrete Host aliases are listed; wildcard/negated rules and known_hosts entries are not connections. It does not read private keys or evaluate Match/ProxyCommand during listing. Conditional Includes are scanned as candidates; OpenSSH resolves actual conditions on connection. Dynamic host-dependent Include tokens and other users’ `~user` paths are skipped with a warning; manual entry remains available. If DSH runs on a server, the list belongs to that server user, not the browser computer.

### Noninteractive Claude environment

An interactive terminal finding `claude` does not guarantee that noninteractive SSH can find it. Detection first uses `command -v claude`, then checks common locations under `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, and nvm. Specify an absolute executable path to resolve version ambiguity.

The executable's directory is added to PATH only for the launched process, helping installations with a sibling nvm node or Homebrew executable. Remote shell configuration is never modified. If node lives elsewhere, configure the noninteractive environment yourself or use a native Claude binary that works there.

### Workspace binding and persistence

Each workspace binds a stable host ID, host configuration revision, remote user, and canonical absolute remote path. Unbound/local sessions and cross-host model selections are blocked in both the UI and backend. The directory is revalidated before each turn; a failed directory check or `cd` stops execution. There is no fallback to the remote HOME directory or local execution.

DSH's workspace registry currently accepts local directories only. The plugin keeps its own remote workspace registry, creates no local placeholder project, and performs no synchronization.

DSH 0.2.1-rc.2 requires a session cwd for native history and cold resume. The plugin stores `/__dsh_claude_ssh_remote__/<host-id>/<workspace-id>` as routing metadata only. It never creates this local directory and refuses session creation if the address already exists. Public waterfalls skip local directory/instruction/tool preparation only for bound remote sessions, which use a dedicated composer. Execution always uses the bound remote path. DSH's native file panel cannot browse this metadata address, and its native terminal directory check fails; neither is a remote file or terminal interface.

State defaults to `$DSH_HOME/storages/dsh-claude-ssh/state.json`, using `~/.dsh` when DSH_HOME is unset. Atomic writes with mode 0600 persist hosts, workspaces, bindings, Claude IDs, sent message IDs, and run state, without login tokens. Existing local sessions cannot be converted to remote ones. Duplicating or clearing a session does not automatically inherit its binding; create a new session from the remote workspace.

Changing a host's SSH target, port, or Claude path invalidates existing bindings. Revalidate the workspace and create a new session. Display names may be changed. Deleting a host/workspace preserves historical bindings but blocks further execution. Use a new host ID rather than repointing an existing SSH alias to another machine; SSH host-key and remote-user checks still apply.

Override the state directory in the DSH profile if needed:

```yaml
- id: dsh-claude-ssh
  config:
    stateDir: /absolute/path/to/dedicated-state-directory
```

Do not share a stateDir between running DSH processes. Each profile can use a separate directory. Uninstalling the plugin does not remove remote Claude sessions or projects.

## Interruption and recovery

Cancellation sends an `interrupt` over stdio, then closes SSH and terminates the local SSH child if necessary. After a disconnect, the plugin cannot guarantee that remote Claude or its child commands have stopped. There is no background keeper. Restarting DSH marks leftover running sessions as interrupted.

The plugin does not automatically reconnect, retry, or resend sent messages. Check remote tasks and files, then select **已检查远端，允许继续会话** (Remote checked; allow continuation) above the composer. Send a **new instruction**, such as “Check the current state before continuing; do not repeat the previous modification.” The CLI resumes the original Claude session ID using `--resume`. If the remote session history is unavailable or initialization never completed, create a new session from the workspace. The plugin does not silently recreate and replay the old task.

## Troubleshooting

| Error | What to check |
|---|---|
| SSH list: unsupported backend / unknown operation | Fully quit DSH, install the same plugin version into the correct profile, then reopen. Compare the displayed client/server versions and config path. |
| `WORKSPACE_REQUIRED` | Create a session from a verified workspace in Claude SSH settings. |
| `HOST_MISMATCH` / `BINDING_CHANGED` | The selected model belongs to another host, or the binding is stale. Create a new valid binding. |
| `REMOTE_DIRECTORY` | Directory existence, read/execute permissions, and changed symlink targets. Failure never falls back to HOME. |
| `SSH_AUTH` | Target user, Agent, keys, and authorized_keys. Local Claude login is unrelated. |
| `SSH_HOST_KEY` | Verify the fingerprint before updating known_hosts. Keep verification enabled. |
| `SSH_CONNECTION` / `SSH_TIMEOUT` | Network, port, SSH config, ProxyJump, and the SSH service. |
| `CLAUDE_MISSING` | The target user's noninteractive PATH, absolute executable path, and nvm node. |
| `CLAUDE_LOGIN` | Run `claude auth login` on the target as the SSH user. |
| `CLAUDE_AUTH_UNKNOWN` / `CLAUDE_PROTOCOL` | Update remote Claude; inspect `auth status --json` and `--help`. |
| `RECOVERY_REQUIRED` | Inspect remote state, then explicitly allow continuation. Do not resend the original task. |

If `dsh plugin` reports a missing pnpm/Corepack executable, repair the package manager or install pnpm in a temporary directory and prepend its `.bin` directory to PATH. These are installation-environment issues.

## Known limitations

- DSH Web is supported. The native Desktop host and deployments behind a proxy path prefix have not been tested.
- Built-in file and terminal panels remain local features and are clearly labeled. There is no remote file panel or interactive SSH terminal. Remote tool activity appears as remote tool/result text, never as executable local DSH tool calls.
- Text only: no image/attachment upload, local-project synchronization, or conversion of DSH tools into remote MCP tools. Claude loads remote MCP itself. Unknown control requests, including generic MCP elicitation, are rejected; general form forwarding is not implemented.
- One foreground request per session, without queueing or steer. No background reception after disconnect, and no automatic synchronization of DSH history branches with remote rewind. Each foreground reply closes its SSH process; avoid background agents requiring continued interaction.
- Local DSH context compression and automatic title helper requests do not call remote Claude. Claude manages its own context. Advanced DSH goal loops, subagents, and scheduling are outside this release's acceptance scope.
- Existing remote Claude permission rules may allow or deny actions directly. The plugin does not change those rules or enable permission bypass.
- State is not automatically rebound when moved between machines and cannot be shared by multiple processes. Stop services and back up state before editing it or remote Claude session files.

## Development and validation

Run from the repository root after `pnpm install --frozen-lockfile`. See the [workspace guide](../../docs/development.md) for shared tools and adding plugins.

```sh
pnpm --filter dsh-claude-ssh typecheck
pnpm --filter dsh-claude-ssh test
pnpm --filter dsh-claude-ssh build
pnpm --filter dsh-claude-ssh check
pnpm --filter dsh-claude-ssh test:ui
pnpm --filter dsh-claude-ssh pack:plugin
```

`test:ui` requires `agent-browser` on PATH and an installed Chromium/Chrome browser. It uses Chrome from its standard macOS path, or `DSH_TEST_BROWSER_PATH` when set. It runs real mouse and keyboard regression checks for both the main document and a separate settings document, and closes its temporary browser afterward. No SSH or model calls occur.

Tests use the Node test runner. Protocol fixtures replace Claude and consume no model quota. Directory tests run real zsh → POSIX sh commands, but fixture tests are not real SSH or Claude inference validation.

Current results: type checking, **31 automated tests**, and the build pass. Real SSH to the local macOS machine verified installation, Claude detection, file-write approval, user questions, and continuation after a DSH restart. Linux, a second physical host, and interruption/cancellation of a real long-running task remain untested.

See [real SSH acceptance steps](docs/acceptance.md), [interface investigation](docs/interfaces.md), and [validation results](docs/validation.md). These detailed documents are currently in Chinese.

## License and acknowledgments

MIT. Implementation is based on inspected installed DSH types and source. SSH, stream-json, and permission protocol research referenced [lcestou/dsh-oh-my-claude](https://github.com/lcestou/dsh-oh-my-claude) (MIT); this plugin's modules were implemented independently. Attribution and the upstream MIT notice are included in [THIRD_PARTY_NOTICES.md](docs/THIRD_PARTY_NOTICES.md).
