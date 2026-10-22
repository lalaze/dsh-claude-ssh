# DSH Plugins

[English](README.md) | **简体中文**

用于开发多个 DeepSeek Harness 插件的 pnpm 大仓。每个插件独立维护包名、版本、清单、源码、测试、文档和安装包。

| 插件 | 目录 | 功能 |
| --- | --- | --- |
| `dsh-claude-ssh` | [packages/claude-ssh](packages/claude-ssh/README.zh-CN.md) | 在 DSH 中通过系统 OpenSSH 使用远端 Claude Code |
| `dsh-usage-stats` | [packages/usage-stats](packages/usage-stats/README.zh-CN.md) | 统计 DSH 模型与 Claude SSH 远端调用的 Token 用量，支持筛选、分组和 CSV 导出 |

## 初始化

需要 Node.js ≥ 22.15.0，pnpm **10.34.7**（已在 `package.json` 中锁定）。

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm check
corepack pnpm pack:plugins
```

如果已有对应版本的 pnpm，可直接使用 `pnpm`。依赖统一在仓库根目录安装，只维护根目录的 `pnpm-lock.yaml`。

## 开发命令

```sh
pnpm build          # 构建所有包
pnpm typecheck      # 检查所有包的类型
pnpm test           # 运行各包测试
pnpm check          # 类型检查、测试、构建
pnpm test:ui        # 运行已有的浏览器回归
pnpm pack:plugins   # 构建并打包，产物集中到 dist/
```

只操作某个插件：

```sh
pnpm --filter dsh-claude-ssh check
pnpm --filter dsh-claude-ssh test:ui
pnpm --filter dsh-claude-ssh pack:plugin
```

`test:ui` 需要 `agent-browser` 和 Chrome/Chromium，浏览器路径配置见[插件文档](packages/claude-ssh/README.zh-CN.md#开发与验收)。

## 安装插件

构建后按插件安装到目标 DSH profile：

```sh
pnpm pack:plugins
dsh plugin --profile web add "$PWD/dist/dsh-claude-ssh-0.2.1.tgz"
```

桌面端请完全退出 DSH，将参数改为 `--profile desktop` 后安装并重新打开。Web 端请重启更新的 profile 并刷新浏览器。插件目前未发布到 npm。仓库根目录是私有工作区，安装时应使用各插件的压缩包。

## 目录与新增插件

```text
packages/
  claude-ssh/           # dsh-claude-ssh 的源码、测试、清单和文档
  usage-stats/          # DSH 与 Claude SSH 使用量统计
scripts/
  build-client.mjs      # 共用的 DSH Web 客户端打包脚本
tsconfig.base.json     # 共用 TypeScript 编译选项
pnpm-workspace.yaml    # 自动发现 packages/*
pnpm-lock.yaml         # 全仓依赖锁文件
dist/                  # 生成的安装包，不提交
```

后续插件放在 `packages/<插件目录>`，声明独立包名、版本及标准的 `build`、`typecheck`、`test` 命令，根目录命令会自动覆盖新包。公共工具放在根目录，插件专用依赖放在插件自己的清单中，各插件独立发布。

完整约定见[开发指南](docs/development.md)，包括插件清单、客户端构建、打包和共享代码处理。

MIT；第三方署名见对应插件文档。
