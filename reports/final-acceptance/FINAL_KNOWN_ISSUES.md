# 最终已知问题

日期2026-11-21。当前冻结建议：HOLD。未修改业务源码。

| ID | 状态 | 等级/冻结影响 | 问题及依据 |
|---|---|---|---|
| FA01 | OPEN | P2，当前冻结阻断 | 服务端commit成功但响应丢失，页面重试仍先confirm，已completed任务拒绝，页面停在needs_confirmation。已离线浏览器复现：计划1、confirm2、commit1。agent-ui.js agentConfirm.execute；agent-core.js prepareConfirmation。需使用已有回执重试commit或查询完成状态并增加端到端断言。 |
| K01 | OPEN | P2，需限定交付协议 | 旧confirm模式completed并不等于落盘。现页面新协议不代表外部旧客户端均已迁移。必须依据persistence_status和requires_local_commit解释响应。 |
| K02 | OPEN | P2，恢复能力边界 | 后端Map会话、草稿及任务不跨重启；刷新/会话到期不能恢复远程任务。local_persisted不是远程状态恢复证明。完整跨进程恢复需另行设计，不属于本次审查授权。 |
| K03 | OPEN | P2，并发边界 | Web Locks仅串行化接入的Agent确认；localStorage日志不是原生多键事务。其他旧页面、外部脚本或不遵守锁的写入仍可能产生竞争，不能提供全局可串行化保证。 |
| ENV-Firefox | BLOCKED | 浏览器环境 | Playwright firefox-1538二进制路径不存在；没有Firefox功能通过结论。 |
| ENV-WebKit | BLOCKED | 浏览器环境 | Playwright webkit-2336启动路径不存在；没有WebKit功能通过结论。 |
| API-LIVE | NOT_TESTED | 本轮禁止 | 未调用真实API；只能确认配置接口静态保持，不能证明真实服务可用或Token费用下降。不得把Mock当真实成功。 |
| K06 | OPEN | 存储边界 | 日志保留写前/写后值占额外配额；配额不足会拒绝保存。不能保证设备物理刷盘、用户清空存储后的恢复。 |

四项原失败P04、P05、P10、P11本轮重跑通过；这不关闭FA01，也不消除以上限制。未读取用户设备历史库，历史数据兼容性结论仅限现有样本和已执行测试。

完整FA01复现步骤和证据见 FINAL_ACCEPTANCE_REPORT.md，以及 reports/final-acceptance/response-loss.cjs、response-loss.json。严重程度表示当前已观察影响；冻结门槛因本轮明确的可靠性承诺而设，不把该问题误报为已发生的数据丢失。
