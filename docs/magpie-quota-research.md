# Magpie 账号额度插件可行性调研

调研日期：2026-10-23。按本仓库的用途，目标是开发 DSH 插件，在 DSH 中查看 Magpie 返回的各账号剩余额度。

结论：可以实现。Magpie 已有账号额度查询、单账号刷新和历史接口，DSH 插件只需接入并展示。能展示的范围是 Magpie 能提供读数、且当前网关密钥有权查看的账号。官方已将额度查询列为应用接入能力。[官方接入文档](https://github.com/yetone/magpie/blob/0815c91864fb8e912b49249cc0aac23563d32c03/docs/integrating.md)

本次核对了官方源码提交 `0815c91864fb8e912b49249cc0aac23563d32c03`，并只读访问了本机 Magpie `0.1.1307`。以下分别记录实测结果和实施建议；尚未创建或安装插件。

本机验证中，`GET /api/hello`、`GET /v1/magpie/quotas?kept=1`、`GET /v1/magpie/quotas/cards` 均返回 HTTP 200。后两个接口各返回 6 条记录：

| 账号记录 | 查询时的读数 |
| --- | --- |
| Grok | 7 天窗口剩余 80% |
| Codex / Plus | 5 小时窗口剩余 75%；7 天窗口剩余 65% |
| Codex / Pro Lite | 返回的 7 天窗口剩余 63% |
| WorkBuddy / Free，账号 A | Credits 剩余约 79.42%，同时返回已用值和总额度 |
| WorkBuddy / Free，账号 B | 返回读取错误，窗口为空 |
| WorkBuddy AI / Free | Credits 剩余 100% |

这些是查询时的缓存快照，后续会变化。实测也确认：同一服务商可以返回多个账号，账号窗口数量可以不同，HTTP 200 的列表中可以包含某个账号的读取错误。没有保存账号邮箱、凭据或完整原始响应。

可用接口如下。路径均相对于 Magpie 网关；通常 DSH 已配置的 OpenAI Base URL 以 `/v1` 结尾，拼接时要避免重复 `/v1`，也要保留可能存在的反向代理路径前缀。[网关处理实现](https://github.com/yetone/magpie/blob/0815c91864fb8e912b49249cc0aac23563d32c03/internal/gateway/gateway.go#L778)

| 方法与路径 | 用途与行为 |
| --- | --- |
| `GET /api/hello` | 确认服务是 Magpie，并读取版本 |
| `GET /v1/magpie/quotas` | 标准化额度列表；可以触发额度读取，仍受 Magpie 缓存和读取策略约束 |
| `GET /v1/magpie/quotas?kept=1` | 只取已保存读数，不向厂商发起额度查询，适合轻量展示 |
| `GET /v1/magpie/quotas/cards` | Magpie 自身额度卡片的缓存；字段比标准化列表更丰富，窗口没有直接的 `remaining` |
| `POST /v1/magpie/quotas/refresh?provider=<id>&user=<account>` | 刷新指定账号；不指定账号时可刷新该提供商，不指定提供商时刷新全部允许范围；响应是卡片列表 |
| `GET /v1/magpie/quotas/history?days=<n>&provider=<id>&user=<account>` | 已采集的额度历史，最多回看 45 天；不保证每个时间点都有采样 |
| `GET /v1/magpie/limit` | 当前网关密钥自己的预算，适用于上游账号额度不可见的情况 |

标准化列表的响应外层为 `{ "object": "list", "data": [...] }`。账号提供服务商、账号标识、套餐、额度类型和多个窗口；窗口直接提供已用百分比、剩余百分比以及可选的重置时间。按次数或积分计量的窗口还可能提供已用数值、上限和单位，按量付费的记录可能提供余额。[额度数据定义及转换](https://github.com/yetone/magpie/blob/0815c91864fb8e912b49249cc0aac23563d32c03/internal/provider/quotas.go#L71)

实现时需要保留这些语义：

- `remaining` 是百分比，不是剩余 Token。`amount` 是已用的绝对数量；仅当单位和上限明确时，才能计算绝对剩余值。缺省字段不能直接补零。
- 一个账号的 5 小时、7 天或不同模型池是不同限制，应分别展示。不同套餐或账号的百分比不能直接相加；首版无需估算可用 Token 或可用请求次数。
- `readAt` 是读数时间；`asOf` 和 `readDeferred` 可说明回退到旧值或本次未请求读取。页面的请求完成时间不能充当额度更新时间。
- `error` 要按账号展示；有旧数据时保留旧值并注明状态，完全没有读数时显示“暂无读数”或错误原因。
- 无限额度需要单独显示。没有重置时间时不编造倒计时；套餐到期时间和额度窗口重置时间分别展示。
- `last`、`lastServedAt` 可以标注最近服务过请求的账号，不能据此断定下一次请求仍会使用它。

远端场景可使用现有网关密钥，通过 `Authorization: Bearer <key>` 或 `x-api-key` 访问。网关必须允许网络访问；官方实现支持共享设置，以及通过 `MAGPIE_ADDR` 开放的网络监听。Tailscale 访问同样经过远端鉴权。[网络访问回归用例](https://github.com/yetone/magpie/blob/0815c91864fb8e912b49249cc0aac23563d32c03/internal/gateway/quotas_lan_test.go#L13)

受预算、模型或账号限制的密钥默认会被拒绝访问账号额度，可能返回 `403 gateway_key_held`。所有者可以执行 `magpie gateway-key quotas <id> on` 开启额度可见权限，但开启后仍按模型和账号范围过滤：只能使用某个提供商部分模型的密钥，也可能看不到该提供商的额度。插件应区分“无权限”和“没有账号”。本次没有修改任何权限，也没有实测某个远端网关密钥的可见范围。[官方接入说明](https://github.com/yetone/magpie/blob/0815c91864fb8e912b49249cc0aac23563d32c03/docs/integrating.md)、[权限过滤实现](https://github.com/yetone/magpie/blob/0815c91864fb8e912b49249cc0aac23563d32c03/internal/gateway/quotas_scope.go#L12)

刷新也有两个实际限制：网关对相同刷新目标设置 30 秒间隔；Claude 保存账号的主动读取可能启动该账号自己的 Claude Code `/usage`。因此定时更新应读取列表或缓存，主动刷新由用户点击触发。即使执行刷新，也要检查返回的读数时间及错误。[刷新处理](https://github.com/yetone/magpie/blob/0815c91864fb8e912b49249cc0aac23563d32c03/internal/gateway/gateway.go#L838)、[账号读取约束](https://github.com/yetone/magpie/blob/0815c91864fb8e912b49249cc0aac23563d32c03/docs/subsystems/providers-accounts.md)

另外，`kept=1` 和 `/quotas/cards` 只暴露该 Magpie 自身缓存的卡片，不继续转发它从另一台 Magpie 获取的卡片。如果 DSH 连接的是一个聚合其他 Magpie 的网关，不能用这两个接口代替完整查询；需要使用普通 `/quotas`，或直接配置对应的账号所属网关。远端账号的刷新也要发给实际持有账号的 Magpie。[远端卡片实现](https://github.com/yetone/magpie/blob/0815c91864fb8e912b49249cc0aac23563d32c03/internal/provider/remote_quotas.go#L72)

建议新建独立插件 `dsh-magpie-quota`，入口为 DSH 设置中的「Magpie 额度」。首版按网关、服务商和账号展示卡片，包含套餐、各窗口剩余进度、重置倒计时、读数时间、错误状态和单账号刷新按钮。显示多个网关时，账号身份至少由网关、提供商、账号和额度类型共同确定。

接入方式是“DSH 页面 → 插件后端 → Magpie”，由后端读取已选 Magpie 提供商的地址及凭据，向前端返回展示所需数据。仓库已有对应参考：

- [Magpie Fast 的提供商读取](../packages/magpie-fast/src/config.ts)和[凭据解析](../packages/magpie-fast/src/index.ts)：可沿用其思路，复用现有提供商配置，支持环境凭据、保存的 API Key 及自定义认证头。
- [使用量统计的后端接口](../packages/usage-stats/src/index.ts)和[设置页注册](../packages/usage-stats/src/client/index.tsx)：已有 `ctx.connection.fetch.register` 和 `settings.section` 的接入示例。
- [大仓开发指南](development.md)：新增独立包、构建、打包的约定已具备；不跨包相对导入其他插件的 `src`。

页面打开时读取标准化列表，后端对相同网关及凭据合并并发请求、缓存约 30～60 秒。页面可见时定时更新，隐藏时暂停；切换网关或凭据后隔离旧缓存。刷新响应是卡片结构，须与标准化列表分别解析。首版先完成额度展示和刷新，历史曲线可作为后续功能。

实施验收应覆盖：同提供商多账号、不同窗口数量、部分账号错误、过期读数、无限额度、积分与余额、401/403/404、网关不可达、刷新节流，以及地址路径拼接和认证头保留。本次已验证本机缓存查询和仓库扩展点；主动刷新、远端实际凭据、历史接口和新插件界面尚未进行运行验证。
