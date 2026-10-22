# 本次验证记录

日期：2026-10-21。目标为 macOS 本机经真实 OpenSSH 回环连接；没有将协议夹具称为真实 Claude 验证。

## 构建与自动测试

- `npm run typecheck`：通过。
- `npm test`：**30 项通过，0 失败，0 跳过**（含 SSH 配置、表单、版本与刷新错误回归测试）。
- `npm run build`：通过，生成服务端 JS / 声明与 DSH 客户端模块。
- `npm pack`：生成可安装的 `dsh-claude-ssh-0.1.2.tgz`，含编译产物、清单、中英文 README、接口调查、验收步骤、许可证。

自动测试覆盖：未绑定拒绝、错主机拒绝、配置/路径改变拒绝、无目录停止且不回退 HOME、Claude 缺失/未登录/SSH 分类错误；真实 zsh → POSIX sh 下空目录与中文/空格/引号；stream-json 流式和整帧避免重复；工具结果不产生本地可执行 tool-call；单次允许/拒绝/不可用；AskUserQuestion 协议；未知控制请求返回 error；interrupt、断线、明确恢复；同一消息不重发；多主机多会话并发隔离；原子持久化与重启状态；路由地址不创建本地目录；本地会话 waterfall 原样委托；冷恢复不会误用全局默认模型，显式跨主机选择仍拒绝；移除本机 Claude/Anthropic 凭据和配置环境、保留 SSH Agent，防止 SendEnv 意外转发。

## 真实环境与验收

| 项目 | 实际结果 |
|---|---|
| DSH | 本机 `0.2.1-rc.2`，Node `22.23.2` |
| 插件安装 | 真实 `dsh plugin --profile web add <本地 tgz>` 成功，自动登记 bundle；多次卸载/重装验证新包加载 |
| 隔离 profile | `DSH_HOME=/tmp/dsh-claude-ssh-acceptance`，没有修改现有用户 DSH profile |
| Web UI | 实际浏览器检查设置、保存主机、检测、浏览/保存工作区、创建/打开会话、远端 composer、原生权限与问题界面 |
| SSH | 用户授权配置 `dsh-claude-ssh-self`；专用密钥限制回环来源，保留现有配置并备份 config，主机密钥严格校验 |
| 非交互 Claude | SSH 目标用户 `lalaze`；二进制 `/Users/lalaze/.local/bin/claude`；版本 `2.1.304`；远端 loggedIn=true |
| 真实目录 | 空目录、中文、空格、单引号、子目录、不存在目录均符合预期；macOS 保存规范化的 `/private/tmp/...` 路径 |
| 实际错误分类 | 初始本机 SSH publickey 拒绝；配置后连接通过；显式缺失二进制经真实 SSH 返回 CLAUDE_MISSING |
| 真实模型/工具 | 在独立临时目录调用真实 Claude，执行 pwd，用 Write 创建 acceptance.txt；通过 SSH 实际读回 `DSH_SSH_OK` |
| 真实权限转发 | DSH 原生 Allow once 界面展示准确远端身份与 Write 参数；批准后远端实际落盘 |
| 真实用户问题 | 同一 Claude session 使用 AskUserQuestion，经 DSH 原生选项卡选择“通过”并提交，远端完成该轮 |
| 原生流式历史 | 最终兼容实现的真实会话在 DSH Chat 中展示用户消息、流式回复、完成状态及 `DSH_FINAL_OK` |
| 刷新/重启/续接 | 重启独立 DSH 后原生历史与绑定仍正确；以同一 Claude session ID 发出新的短问题，成功复述 `DSH_FINAL_OK`，不重放文件任务 |
| 本地 UI 隔离 | 切回普通本地新会话，原生输入框/工作区/模型入口正常，没有远程 composer 接管 |
| API 认证 | 不携带 DSH 登录态访问插件 API，实际 HTTP 状态为 401 |

真实模型请求使用现有远端登录与额度，执行前已说明动作。所有文件操作仅在专用 `/tmp/dsh-claude-ssh-*` 验收目录；没有修改业务项目、远端 shell 配置或 Claude 登录配置。

真实验收中发现并修复了 DSH 无 cwd 历史接口限制、首次发布日志时序、冷恢复全局默认模型路由问题；最终成功结果对应修正后的实现，旧实验会话中的失败记录不代表任务已经执行。

本机 Corepack 原先指向不存在的 pnpm 路径，因此安装验收使用 `/tmp/dsh-ssh-package-manager` 下的独立 pnpm，并未修改全局包管理器。npm 打包缓存也使用独立临时目录。

## 明确未实测与未实现

- **未实测**：Linux 实机、第二台物理主机、真实长任务中取消/SSH 断线再恢复、真实未登录 Claude 账号、真实主机密钥异常、nvm/Homebrew 多版本安装、复杂 Hooks/MCP 组合、Desktop 与代理路径前缀。相关错误、取消、断线、多会话行为有协议/进程夹具测试，但不能据此声称已通过所有真实环境验收。
- **未实现**：远端文件面板/交互终端、自动同步或本地附件上传、断线后台 keeper、自动重发、通用 MCP elicitation、DSH 分支/rewind/高级任务调度集成。内置本地面板持续明确标注限制，路由地址不创建本地目录，也不返回伪造文件结果。
- 尚未发布 npm 包；可从仓库源码运行 `npm pack` 生成本地可安装 tarball。

验收结束后关闭独立 DSH、清理已知临时远端目录、关闭自动化浏览器并检查临时 agent-browser 进程。为后续使用保留已授权的本机专用 SSH 配置。

## 本机 SSH 验收配置

0.1.1 SSH 别名选择增量验证：真实配置只读枚举找到 5 个别名（包括 Include 中的本机别名）；隔离 Web profile 安装新包后，在真实浏览器检查下拉列表、自动填充、保存主机、手动输入及刷新保留草稿，并使用选中别名完成非交互 SSH / Claude 检测。此次没有调用模型或修改远端文件，也未修改现有 SSH 配置。桌面载体的此项增量仍未实测。

新增自动测试覆盖递归/循环/符号链接 Include、相对路径基准、glob、引号、环境变量及 HOME 令牌、通配和否定规则过滤、缺失/超限/错误配置、静态扫描不执行 Match 命令且不解析 IdentityFile，以及主机 ID 保持和新别名端口继承。

**本次工作环境已配置本机别名 `dsh-claude-ssh-self`**，目标 `lalaze@localhost:22`。专用密钥位于 `~/.ssh/dsh_claude_ssh_ed25519`，公钥在 authorized_keys 中限制为回环来源、禁用转发/PTY。独立配置为 `~/.ssh/dsh-claude-ssh.conf`，由现有 config 的 Include 引用；修改前已备份 config。它是当前机器的验收配置，不是安装包的一部分，其他用户应自行配置目标主机。卸载此测试配置时，删除对应 Include、独立文件、专用密钥以及 authorized_keys 中带 `dsh-claude-ssh-self` 注释的单行，保留其他内容。

## 0.1.2 刷新错误与箭头修正

将真实 0.1.0 安装包解压到临时目录，调用其真实 API 处理器，`sshAliases` 请求返回 HTTP 400 / BAD_REQUEST / 未知操作，与用户截图一致；此响应发生在 SSH 配置枚举之前。新客户端先检查后端版本和能力，旧后端会明确提示完全退出并安装相同版本，不再显示为空列表。该复现证明了旧后端的错误模式；没有直接访问用户另一台 Mac 的运行进程，不能断言该机器具体是哪一个 profile/残留进程导致。

新增测试覆盖旧后端、前后端版本差异、缺失能力、正常刷新、普通读取错误、空列表与失败占位分离、版本与清单同步；真实 API 测试核对版本信息和 SSH 列表请求。下拉保留原生键盘行为，统一隐藏系统箭头并显示主题色 SVG。桌面载体仍待目标机器验收。

界面验证：隔离 Web profile 安装 0.1.2，在真实浏览器深色主题核对单一 SVG 箭头的主题色及几何居中、前后端版本一致、真实配置刷新可列出本机别名。随后在浏览器回放旧后端的无版本状态与未知操作响应，断言出现明确退出/更新提示、没有虚假的空列表、不再发送不支持的操作、手动输入仍可用；恢复真实请求后刷新成功。此次未修改 SSH 配置或远端文件，未调用模型。
