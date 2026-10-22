# Claude SSH

[English](README.md) | **简体中文**

`dsh-claude-ssh` 是 DeepSeek Harness 的 TypeScript 插件。在本机 DSH Web 界面，通过系统 OpenSSH 使用目标机器上已经安装、登录的 Claude Code。

远端 Claude 自己执行智能体循环、工具、文件操作和终端命令。本机展示 stream-json 事件，转发 DSH 权限确认、用户问题与取消，不需要远端安装 DSH 或额外服务。

## 安装

首版针对 **DSH 0.2.1-rc.2、Node.js ≥ 22.15、macOS / Linux**。这是实际检查并验证的 DSH 接口版本；其他版本需重新验收。远端需要 OpenSSH、POSIX `/bin/sh`、Claude Code；macOS 默认 zsh 可用。Claude 必须支持 stream-json、stdio 权限转发、`auth status --json` 与 session-id/resume。

从源码构建安装：

```sh
git clone https://github.com/lalaze/dsh-claude-ssh.git
cd dsh-claude-ssh
npm ci --registry=https://registry.npmjs.org
npm run check
npm pack
dsh plugin --profile web add /绝对路径/dsh-claude-ssh-0.1.2.tgz
```

安装到 **DSH 桌面端**：先打开应用一次以初始化 profile，完全退出后，将上述命令的 `--profile web` 改为 `--profile desktop` 执行，再重新打开桌面应用。

Web 端请重启对应 DSH profile，然后刷新浏览器。设置菜单中应出现 **Claude SSH**。插件未发布至 npm；不要使用 `dsh plugin add dsh-claude-ssh` 假定已有公开包。包内含编译产物、客户端模块与 `cordis.patch.yml`，安装无需远端构建。

也可把打包文件传到目标 DSH 主机再执行安装命令。GitHub 安装需仓库包含预编译 `lib`，因此首版推荐 `.tgz`。

## 升级

升级桌面端前请完全退出 DSH，再安装新包到 `--profile desktop` 并重新打开。只关闭窗口可能留下旧后端进程，而界面已加载新的文件。Web 端请重启实际更新的 profile 后端并刷新浏览器。SSH 设置会显示界面/后端版本和实际读取的 SSH 配置路径；版本不匹配或刷新返回“未知操作”属于更新/加载问题，不能据此认定本机没有 SSH 配置。

## 配置与使用

1. 打开 DSH 设置 → **Claude SSH**。
2. 在“从本机 SSH 配置选择”中选择已有连接，也可手动填写 SSH 别名或 `user@host`。选择别名会填入 SSH 目标，并为空白新主机补上标识和名称；仍需点击保存。可选填端口和 Claude 绝对路径。
3. 点击“测试连接与 Claude”。这会在真实非交互 SSH 环境检测目标用户、二进制、版本、登录状态和必要 CLI 参数，**不调用模型**。
4. 选择已保存主机，浏览或输入远端绝对路径，点击“保存远程工作区”。空目录也可以使用。路径必须实际存在、可读且可进入；`~` 不会自动展开。
5. 在已保存工作区中选择 `sonnet`、`opus` 或 `haiku`（Claude CLI 模型别名，实际模型由远端解析），点击“创建远程会话”。
6. 在 DSH 会话中发送文本。输入框上方持续显示 **主机（SSH 目标） / 远端用户 / 远端真实目录**，另显示 Claude session ID 与状态。
7. Claude 需要权限或通过 AskUserQuestion 询问用户时，在 DSH 的原生确认界面作答。权限为单次决定；不可用、关闭或取消时拒绝。远端已有 Claude 权限规则仍由 CLI 执行。

插件只发送本次尚未发送的用户文本。DSH 的本机 system prompt、工具声明和本地登录状态不作为远端 Claude 的配置。远端项目 `CLAUDE.md`、Skills、Hooks、MCP 与现有登录均由目标用户的 Claude Code 读取。Hooks/MCP 的具体组合需要在自己的机器验收。

### SSH 配置

推荐先在运行 DSH 的同一系统用户下确认：

```sh
ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes my-dev-box 'id -un; pwd'
```

插件使用系统 `ssh`，沿用密钥、SSH Agent、known_hosts、SSH config、ProxyJump；不会存储 SSH 密码、私钥或 Claude token。首版只支持非交互密钥 / Agent 认证，密码与交互式 MFA 请先在系统 SSH 层配置。

首次连接未知主机时，请在终端核实指纹并建立 known_hosts。插件始终开启 `StrictHostKeyChecking=yes`，不自动信任新密钥。

连接目标若填写 config 别名，端口留空才沿用 config 的 Port；直接 IPv6 地址请写 `[::1]` 或 `user@[::1]`。

本机也可以作为 SSH 目标，但需要先开启 SSH 服务并配置密钥认证。安装插件不会自动开启服务或更改 SSH 配置。本次开发环境的回环验收配置及卸载方法见[验证记录](docs/validation.md#本机-ssh-验收配置)。

别名列表读取运行 DSH 用户的 `~/.ssh/config`、递归 Include 文件和 `/etc/ssh/ssh_config`；支持常见 Include 通配、双引号路径、`~`、`%d`、`%%` 和 `${变量}`。配置修改后点击“刷新 SSH 列表”。仅列出明确的 Host 别名，不将通配/否定规则或 known_hosts 记录当作连接；不读取私钥，也不在列表阶段执行 Match/ProxyCommand。条件 Include 中的条目会作为候选列出，最终条件由连接时的 OpenSSH 解析。依赖目标主机的动态 Include 令牌及其他用户的 `~user` 路径会提示跳过，仍可手动填写别名。若 DSH 运行在服务器上，读取的是该服务器用户的配置，不是浏览器所在电脑的配置。

### Claude 的非交互环境

终端能运行 `claude` 不等于 SSH 非交互环境也能运行。插件优先 `command -v claude`，再检查 `~/.local/bin`、`/opt/homebrew/bin`、`/usr/local/bin` 与 nvm 常见目录。可配置准确的绝对路径以避免多个版本歧义。

启动时仅把 Claude 二进制所在目录加入该进程 PATH（帮助同目录 nvm node / Homebrew 安装），不修改远端 shell 配置。如果 node 另装在别处，请自行配置非交互环境或填写能在此环境运行的 Claude 原生二进制。

### 会话绑定与持久化

远程工作区由插件独立保存。DSH 当前原生工作区注册器只接受本机目录，因此插件**不创建本地占位项目，不同步文件，不把远端路径伪装成本机 cwd**。

DSH 0.2.1-rc.2 的原生历史与冷恢复接口要求 Session header 存在 cwd。插件使用 `/__dsh_claude_ssh_remote__/<主机标识>/<工作区ID>` 作为**仅用于路由的元数据地址**，不会在本机创建它；如这个地址在本机已经存在则拒绝创建会话。远程会话通过公开 waterfall 跳过本地指令/目录/工具准备，并使用独立 composer。真正的远端路径始终来自工作区绑定，绝不取该路由地址。原生文件面板无法访问此地址，不能用来浏览远端文件；原生终端的目录检查也会失败。

存储位置默认 `$DSH_HOME/storages/dsh-claude-ssh/state.json`（未设置 DSH_HOME 时为 `~/.dsh` 下同一路径），原子写入、文件权限 0600，保存主机、工作区、会话绑定、Claude ID、已发送消息 ID 和运行状态，不保存登录令牌。会话绑定固定，不能将已有本地会话直接切换为远程会话。复制会话、清空会话等未自动继承插件绑定，需从远程工作区新建。

修改主机的 SSH 目标、端口或 Claude 路径会使旧绑定失效；重新验证工作区并新建会话。显示名称可以修改。删除主机/工作区会保留历史会话绑定，但后端拒绝再次执行。不要修改同一 config 别名去指向另一台机器后继续旧会话；请使用新主机标识。SSH 主机密钥和远端用户检查仍会执行。

可在 DSH profile 覆盖插件的 `stateDir`：

```yaml
- id: dsh-claude-ssh
  config:
    stateDir: /绝对路径/专用状态目录
```

不要让多个 DSH 进程同时写同一个插件 stateDir；每个 profile 可指定自己的目录。卸载插件不会删除远端 Claude 会话或项目。

## 中断与恢复

取消会经 stdio 发送 `interrupt`，随后关闭 SSH，必要时终止本地 SSH 子进程。断线时无法保证远端 Claude 或其子命令已经停止；首版没有后台 keeper。DSH 重启会将遗留 running 状态标为中断。

插件不自动重连、不自动重试、不重发已发送的消息。先在远端检查任务与文件状态，再点击输入框上方“已检查远端，允许继续会话”。之后输入一个**新指令**，例如“先核对当前状态，不重复执行上次修改”。CLI 使用原 Claude session ID 的 `--resume`。若远端会话记录不存在或启动前已中断到无法续接，请从工作区新建会话；不会悄悄重建并重跑旧任务。

## 排错

| 提示 | 检查 |
|---|---|
| SSH 列表版本不匹配 / 未知操作 | 完全退出 DSH，将同版本插件装入正确 profile 后重开；核对页面显示的前后端版本与配置路径 |
| `WORKSPACE_REQUIRED` | 在 Claude SSH 设置中选择已验证工作区并新建会话 |
| `HOST_MISMATCH` / `BINDING_CHANGED` | 所选模型属于其他主机，或绑定已失效；不要更改旧绑定 |
| `REMOTE_DIRECTORY` | 远端目录存在、读权限、执行权限、符号链接目标是否改变；失败绝不回退 HOME |
| `SSH_AUTH` | 目标用户、Agent、密钥及 authorized_keys；本机 Claude 登录无关 |
| `SSH_HOST_KEY` | 核实目标主机指纹，再处理 known_hosts，勿关闭校验 |
| `SSH_CONNECTION` / `SSH_TIMEOUT` | 网络、端口、config、ProxyJump、远端服务 |
| `CLAUDE_MISSING` | 远端用户的非交互 PATH；指定绝对路径；检查 nvm node |
| `CLAUDE_LOGIN` | 用目标 SSH 用户在远端执行 `claude auth login` |
| `CLAUDE_AUTH_UNKNOWN` / `CLAUDE_PROTOCOL` | 升级远端 CLI；检查 `auth status --json` 和 `--help` |
| `RECOVERY_REQUIRED` | 人工核实远端后点击恢复；不要重复发送原任务 |

如果 `npm pack` 报缓存权限问题，可使用 `npm pack --cache=/tmp/dsh-package-cache`，无需修改整个用户缓存目录权限。如果 `dsh plugin` 报 pnpm/corepack 路径缺失，先修复当前环境的包管理器，或在临时目录安装 pnpm 并把它的 `.bin` 放在 PATH 前再安装。该问题不来自插件。

## 已知限制

- 支持 DSH Web 界面；Desktop 原生载体和反向代理带路径前缀的部署尚未实测。
- DSH 内置文件和终端面板仍是本地功能。输入框与设置页有明确标注；没有远端文件面板或交互式 SSH 终端。远端工具活动以“远端工具 / 结果”文本显示，不交给 DSH 本地工具执行器。
- 只支持文本，不自动上传图片/附件，不同步本地项目，不支持 DSH 工具转成远端 MCP。远端 MCP 自身仍由 CLI 加载；MCP elicitation 等未知控制请求首版拒绝，未实现通用表单转发。
- 一会话只支持一个前台请求，不提供队列/steer。不支持 Claude 后台任务在断线后由 DSH 继续接收，不支持 DSH 历史分支与远端 rewind 自动同步。每次前台回复结束关闭该 SSH 进程；请避免在这些会话中启动需要长期交互的后台智能体。
- DSH 的本地上下文压缩和自动标题辅助请求不会调用远端 Claude；远端上下文由 CLI 管理。DSH 的更高级自动目标循环、子智能体、排程等不属于首版验收范围。
- CLI 可能依据远端已存在的权限规则直接允许或拒绝操作；插件不修改这些规则，也不使用 bypass 权限模式。
- `state.json` 不支持跨机器迁移时自动改绑，不支持多个进程共用。修改 state 文件或远端 CLI 会话文件前先停服务并备份。

## 开发与验收

```sh
npm run typecheck
npm test
npm run build
npm run check
npm pack
```

测试采用 Node test runner。核心协议夹具代替 Claude、不消耗额度；目录测试通过真实 zsh → POSIX sh 执行，但不能把这些夹具测试称为真实 SSH / Claude 推理测试。

当前验证结果：类型检查、30 项自动测试和构建通过；macOS 本机经真实 SSH 完成安装、Claude 检测、文件写入权限确认、用户问题与重启后续接。Linux、第二台物理主机以及真实长任务断线/取消尚未实测。

真实 SSH 验收步骤见 [docs/acceptance.md](docs/acceptance.md)，实际接口调查见 [docs/interfaces.md](docs/interfaces.md)，本次验证记录见 [docs/validation.md](docs/validation.md)。

## 参考与许可证

实现以已安装 DSH 类型和源码为依据。SSH / stream-json / 权限协议研究参考 [lcestou/dsh-oh-my-claude](https://github.com/lcestou/dsh-oh-my-claude)（MIT），独立实现了本插件模块；没有复用其全局文件系统接管、HOME 回退或后台服务设计。相关署名与 MIT 文本保存在 [docs/THIRD_PARTY_NOTICES.md](docs/THIRD_PARTY_NOTICES.md)。本插件使用 MIT 许可证。
