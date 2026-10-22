# 实际接口调查

检查日期：2026-10-21。主机实际 `dsh --version` 为 **0.2.1-rc.2**，不是按记忆推断。

已检查仓库至文件系统根路径沿途的 AGENTS.md；没有额外项目文件。执行用户提供的全局指令。开始时仓库只有初始化提交。

以下接口均来自本机安装包的 `lib/types/*.d.ts` 与必要的 `lib/index.js` / `lib/client.js`，依赖版本锁定在 package-lock.json：

| 包 / 文件 | 使用的公开接口 |
|---|---|
| `@deepseek-ai/dsh-llm` / index、types、retry-policy | `LlmAdapter.stream`、providerInfo、listModels、providerRetryPolicy、registerAdapter、GenerateOptions.sessionId、StreamChunk |
| `@deepseek-ai/dsh-agent` / index、runtime-types | `agents.create({sessionId, agentOptions})`、agents.get、AgentHandle.dispose、agent/request waterfall |
| `@deepseek-ai/dsh-session` | SessionId 类型与构造器 |
| `@deepseek-ai/dsh-api-session-controller` | sessionController.rename / prompt / cancel；create 默认赋予本机 cwd，follow/sourceFor 与冷恢复拒绝无 cwd 会话，因此 agents.create 设置仅用于路由的不存在地址，不调用本地目录创建 |
| `@deepseek-ai/dsh-user-approval` | approval.request 的 agent、toolName、reason、signal，allowed-once 等 outcome |
| `@deepseek-ai/dsh-user-questions` | userQuestions.ask、AskUserQuestionItem、AskUserQuestionAnswer、plan-review intent |
| `@deepseek-ai/dsh-client-connection` | connection.fetch.register：准确完整路径 `/api/claude-ssh`，经过 DSH Host / Origin / 认证及 owner 权限检查 |
| `@deepseek-ai/dsh-client-ui-settings/client` | settings.section slot 与 close 参数 |
| `@deepseek-ai/dsh-client-ui-conversation/client` | conversation.input.dock、useProjection、conversation.blocks.set / storeFor |
| `@deepseek-ai/dsh-client-ui-workspace/client` | uiWorkspace.openSession |
| `@deepseek-ai/dsh-client-modules` | package.json 的 dsh.client 与 `window.__ModuleLoader__.load` CJS 包装格式 |
| `@deepseek-ai/dsh-workspace` | create 只支持本地 fs.realpath 的实际目录，不支持远程 URI，因此不调用它制造占位工作区 |
| `@deepseek-ai/dsh-system-prompt`、`@deepseek-ai/dsh-agent` | 公开 system-prompt/assemble 与 agent/pre-step waterfall，绑定会话跳过本地目录/指令/工具准备；非绑定会话完整调用 next，global 监听只扩大事件可见范围，分支判断仍逐会话执行 |

客户端只镜像上述公开接口的窄 TypeScript 形状，未引用不稳定的 DOM 私有选择器或 monkey-patch 任何服务。服务端直接对官方包类型编译。客户端 slot 使用 inject 等待 slot owner 注册，避免启动顺序竞态。

`conversation.composer` 是公开 chain slot：仅已绑定会话且没有 pendingInteraction 时选中远程 composer，权限与用户问题交还原生 chain。初始 model/selection 事件在 agents.create 的 setup 中提交，使持久化日志在会话发布前已经可读。切换模型不会调用会写全局默认模型的 selectModel，而保存会话自身的选择并在 agent/request 校验后路由。注册一个新主机不会注销其他主机的适配器。

插件清单采用实际 DSH 的 `dsh.bundle.patch` 与 `dsh.client` 格式，`dsh plugin --profile web add <tgz>` 自动登记 bundle。没有凭空设计 plugin.json。

参考插件研究固定在提交 `cc7f3014016e5bc3cd7ce85050de04cf61069901`：process.ts、adapter.ts、permissions.ts、remote-fs.ts、client/picker.tsx、client/shared.ts 与 cordis.patch.yml。参考其 stdio 控制响应、AskUserQuestion 和远程工作区交互，独立实现绑定和 fail-closed 校验。

Claude 协议来源：本机 CLI `2.1.304 --help` 只用于核对参数；运行时的检测和登录判断一律通过目标 SSH 用户执行。外部来源包括 [官方 CLI reference](https://code.claude.com/docs/en/cli-reference) 和 [官方 Python Agent SDK 的控制协议实现](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/query.py)。CLI stdio 控制协议随版本可能变化，运行时拒绝不支持的参数或不识别的状态，不静默降级。

当前下拉弹层通过公开 React DOM `createPortal` 挂载到触发按钮 ownerDocument.body，并以所属窗口的视口和事件监听定位；已核对 DSH 自带客户端模块同样使用 ModuleLoader 的 `react-dom` 外部模块。样式使用实际主题包中的 `--dsw-alias-bg-layer-*`、`--dsw-alias-label-*`、`--dsw-alias-border-*` 与交互颜色令牌，并提供回退颜色。
