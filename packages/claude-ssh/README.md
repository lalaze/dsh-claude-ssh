# Claude SSH

[简体中文](README.zh-CN.md) | English

**Claude SSH (`dsh-claude-ssh`) is a modified version of [Oh My Claude 1.5.5](https://github.com/lcestou/dsh-oh-my-claude/tree/19a528fcab3f3a462935b0aa154d68e170cdedb2).** The Claude Code adapter, approvals, persistent conversations, model controls, settings, and memory/rewind/changes panel come from the upstream project. This version adds verified remote-workspace routing, workspace-specific model visibility, and DSH compatibility fixes while retaining the `dsh-claude-ssh` package name. Thanks to the Oh My Claude authors for the original implementation; the upstream MIT license and copyright notice are retained.

Claude models appear in one **Claude** group only in verified remote workspaces. Local projects and unverified workspaces keep their other DSH providers and hide Claude. The native model picker and `/model` share this session-specific view, and login checks use that workspace's remote host.

## Remote workspace compatibility

- dsh-remote mirrors are resolved from their registered `.dsh-remote-meta.json`, including subdirectories. Host, user, port, and remote directory come from the session's mirror, independent of the currently active remote connection.
- SSH aliases retain their keys and ProxyJump settings. The connection is pinned to the registered host/user/port and refuses directory or identity changes.
- Workspaces routed by DSH's public subprocess service are verified against saved SSH targets. Claude runs through that same subprocess service.
- Eligibility requires a matching saved target, a remote execution identity, and an available, logged-in Claude Code CLI. The server verifies execution as well as filtering the model menu.

Existing target definitions are read from `$DSH_HOME/storages/dsh-claude-ssh/state.json` (default `~/.dsh`) alongside the template's saved SSH boxes. New boxes can be managed in **Settings → Oh My Claude**.

## Install

Requires Node.js >=22.15.0 and DSH 0.2.1-rc.2. At the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter dsh-claude-ssh check
pnpm --filter dsh-claude-ssh pack:plugin
```

Install `dist/dsh-claude-ssh-0.3.2.tgz` using DSH's Plugins page in the intended profile, replacing the existing package. Reload its client after the plugin has reloaded. A terminal installation for a Web profile is:

```sh
dsh plugin --profile web add "$PWD/dist/dsh-claude-ssh-0.3.2.tgz"
```

Do not enable the upstream package alongside this package: both implementations own the same Claude routes and panel slots.

## Migration from 0.2.x

The old custom Settings page, dedicated SSH composer, and old adapter have been replaced. The model provider is now `claude-code`; existing saved selections using `claude-workspace` or `claude-ssh-*` must be selected again in a verified workspace. Old DSH history is not deleted, but the old `nativeBindings`/`bindings` are not converted into the template's Claude resume IDs. Start a new conversation to avoid implying continuity with an old remote task.

Runtime state is not rewritten by the source migration.

## Development and validation

`pnpm --filter dsh-claude-ssh check` runs TypeScript, the upstream regression suite plus compatibility tests, and server/client builds. Tests run under Node with per-file temporary state, using real DSH UI modules and a CSS-module loader. They do not contact a real Claude account. Live browser and remote account checks are separate from these offline tests.

See [UPSTREAM.md](UPSTREAM.md), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and the retained upstream [feature documentation](docs/panel.md). The feature documents describe the template; workspace admission follows the rules above.
