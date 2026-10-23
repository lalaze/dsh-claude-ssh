# Claude SSH

简体中文 | [English](README.md)

**Claude SSH（`dsh-claude-ssh`）是基于 [Oh My Claude 1.5.5](https://github.com/lcestou/dsh-oh-my-claude/tree/19a528fcab3f3a462935b0aa154d68e170cdedb2) 修改的版本。** Claude 执行、审批、会话续接、模型控制、设置页，以及 Memory / Rewind / Changes 等面板均沿用上游实现。本版本在此基础上增加远程工作区验证与路由、按工作区显示模型，以及 DSH 兼容性修复；安装包继续使用 `dsh-claude-ssh`，可替换现有插件。感谢 Oh My Claude 作者提供原始实现，上游 MIT 许可及版权声明均予以保留。

保留原有显示规则：只有已验证、匹配目标主机的远程工作区才显示一组 **Claude** 模型。本机项目和验证失败的工作区隐藏 Claude，其他 DSH 模型照常显示。原生模型菜单与 `/model` 使用同一份会话目录；登录检查以该工作区的远端为准。

## dsh-remote 与工作区兼容

- 从会话所属镜像的 `.dsh-remote-meta.json` 读取真实远程目录、主机、用户和端口，支持镜像下的子目录；不依赖当前激活的远端连接。
- 沿用 SSH 别名的密钥和 ProxyJump，同时固定镜像声明的端点。元数据、执行身份或已绑定目录变化时拒绝继续。
- 通过 DSH 公共 subprocess 服务执行的远程工作区，先验证身份与已保存目标一致，再通过同一服务启动 Claude。
- 目标必须匹配已保存主机，执行环境必须是远程环境，Claude CLI 必须可用且已登录。后端执行前再次验证，显示过滤不是唯一检查。

兼容读取原来的 `$DSH_HOME/storages/dsh-claude-ssh/state.json` 主机配置；未设置 `DSH_HOME` 时使用 `~/.dsh`。同时读取模板的 SSH Boxes。新主机可在 **设置 → Oh My Claude** 中管理。

## 构建与安装

需要 Node.js ≥22.15.0 和 DSH 0.2.1-rc.2。在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm --filter dsh-claude-ssh check
pnpm --filter dsh-claude-ssh pack:plugin
```

通过目标 DSH profile 的插件页面安装 `dist/dsh-claude-ssh-0.3.2.tgz`，替换现有包；插件重新加载后刷新页面。Web profile 也可使用：

```sh
dsh plugin --profile web add "$PWD/dist/dsh-claude-ssh-0.3.2.tgz"
```

不要同时启用原版 `dsh-oh-my-claude` 与本插件，两者会注册相同的 Claude 路由和面板。

## 从 0.2.x 迁移

旧的自定义设置页、独立 SSH 输入框和执行适配器已替换。新的模型 provider 为 `claude-code`；原来选择了 `claude-workspace` 或 `claude-ssh-*` 的会话，需要在通过验证的工作区重新选择模型。历史 DSH 对话不会删除，但旧 `nativeBindings` / `bindings` 不会转换为模板的 Claude resume ID。建议新建对话，避免误认为还在继续旧远端任务。

源码迁移不改写运行时状态。

## 开发与验收

`pnpm --filter dsh-claude-ssh check` 会执行类型检查、模板回归测试与新增兼容测试，以及服务端和客户端构建。测试使用 Node，为每个测试文件隔离临时状态；客户端测试加载真实 DSH UI 模块，通过 CSS loader 处理样式。离线测试不使用真实 Claude 账号，浏览器和真实远端调用需要单独验证。

模板来源、版本和许可见 [UPSTREAM.md](UPSTREAM.md)、[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)；功能说明保留在[模板面板文档](docs/panel.md)中。模板文档中的工作区使用方式以本文的验证规则为准。
