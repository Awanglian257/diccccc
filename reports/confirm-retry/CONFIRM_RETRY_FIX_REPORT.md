# 健康管家2.1.1：确认重试专项修复报告

日期：2026-11-21（上海时间）。FA01状态：**VERIFIED**。本轮未发布、未推送、未调用真实DeepSeek API、未新增Agent。

## 1. 原问题与修复前证据

已阅读 FINAL_ACCEPTANCE_REPORT.md 的FA01及对应探针。先用原探针重现：本机计划1份，服务端completed，前端needs_confirmation；再次点击时confirm请求累计2次、commit仅1次，页面无法恢复。`reports/confirm-retry/fa01-before.json`、`before-probe.log`保留该失败。

先新增提交绑定、状态查询、失败重试及并发状态测试，修复前3项均失败，见`unit-before.log`；补充非法标识测试也先失败，见`key-validation-before.log`。原始失败原因是页面不区分“准备确认”与“查询既有提交”，重复ACK虽幂等，页面却在重试时首先调用拒绝completed任务的prepare。

## 2. 修复与影响范围

只修改四份已有文件：

| 文件/函数 | 变更 |
|---|---|
| agent-core.js / prepareConfirmation、commitStatus | 首次确认接收稳定idempotencyKey，绑定到confirmation.id；拒绝非法/冲突标识。新增同一任务/凭据的提交结果查询。沿用原commitReceipt凭据校验、并发去重和已完成回执幂等返回。 |
| server/agent-router.js / route | confirm透传idempotency_key；新增同源、原会话授权的GET commit-status端点。 |
| agent-ui.js / agentConfirm、agentQuerySubmission、agentRememberSubmission、agentRestoreSubmissions | 首次请求前保存稳定标识；重试先查原结果；已提交则恢复完成，不再prepare或写计划；明确未提交才使用原标识继续。保存待确认信息与原会话恢复凭据，刷新后查询恢复。 |
| index.html | 同步以上核心/页面内嵌模块，没有重做UI或修改其他业务逻辑。 |

新增`tests/confirm-retry.test.cjs`和`tests/confirm-retry-browser.cjs`。`agent-storage.js`、模型适配器、package.json和原有已跟踪测试源码本轮未改，哈希/差异核对见`integrity.json`。三份内嵌模块一致，10段脚本解析通过，git diff --check通过。

## 3. 幂等与结果恢复协议

1. 页面首次请求前创建submission标识；同一任务后续重试、查询及刷新恢复均复用该标识。服务器绑定为confirmation.id，不仅依赖按钮禁用。
2. 现有浏览器原子事务把业务更新与`hm_agent_commit_receipts_v1`回执一起保存。正式计划、兼容计划、实际记录的主体格式保持不变。
3. 新增辅助键`hm_agent_pending_confirm_v1`记录原任务、原提交标识及远程标记；原会话令牌只存同标签页sessionStorage，以供刷新恢复，不存真实模型Key。
4. `GET /api/agents/tasks/:id/commit-status?confirmation_id=:key`返回`committed`、`not_committed`、`committing`或`unknown`及匹配任务；错误凭据拒绝，任务/会话缺失不当作“未提交”。
5. 查询committed且本机存在匹配回执：前端恢复completed/succeeded，不重新写业务数据、不再次prepare。查询not_committed：复用原准备结果或原标识安全继续；查询committing、不可达、会话过期或未知：等待结果确认，不创建新提交。
6. 确认相关请求有10秒客户端等待上限。超时仅表示结果不确定，不能解释成服务端未提交。此超时只作用于确认/提交/结果查询端点，不改变模型任务创建或轮询逻辑。

界面分别显示“提交中”“提交成功”“提交失败”“等待结果确认”，以submission_state作为附加页面状态，保留原任务状态枚举和旧接口兼容性。

## 4. 修复前后对比

| 场景 | 修复前 | 修复后 |
|---|---|---|
| 服务端commit完成但响应丢失 | 重试先confirm，被completed任务拒绝 | 使用原标识查询并恢复成功；计划仍1份，confirm1、commit1、query1 |
| 请求未送达/超时 | 无可靠查询路径 | 查询明确未提交后，使用同一标识重发commit，不重复本机写入 |
| 反复查询失败 | 状态混淆，不能收敛 | 保持等待结果确认；查询恢复后使用同一标识完成，无新业务提交 |
| 页面刷新 | 本机保存状态与远端ACK无法恢复 | 原会话仍有效时查询恢复；会话失效则明确未知，不擅自成功或重建 |

## 5. 专项自动化验收

Node4项：稳定标识绑定与幂等结果；明确失败/冲突/未知；提交中并发查询且适配器只执行一次；非法或冲突标识不得改变绑定。

浏览器11项，使用真实127.0.0.1 HTTP及系统Chromium，模型关闭，故障仅注入传输层：

| ID | 场景 | 结果 |
|---|---|---|
| CR01 | 正常提交 | PASS |
| CR02 | 服务端提交成功、响应丢失后查询恢复 | PASS |
| CR03 | 连续并发点击确认 | PASS |
| CR04 | 客户端10秒超时后查询原结果并安全完成 | PASS |
| CR05 | 查询确认尚未提交后重试同一提交 | PASS |
| CR06 | 多次查询失败/重试，始终同一标识且不重复写入 | PASS |
| CR07 | 响应丢失后刷新，查询恢复完成状态 | PASS |
| CR08 | 刷新后状态查询不可达，不重新提交 | PASS |
| CR09 | 真实后端会话被移除后视为未知 | PASS |
| CR10 | 准备确认响应丢失后，查询取回原准备结果 | PASS |
| CR11 | 首次commit未到达，刷新后查询并安全完成 | PASS |

修复后FA01以真实HTTP的CR02复测相同行为断言；没有改低历史探针或原测试断言，也未把旧探针的部分传输适配器当作新HTTP查询协议的实现。原四项缺陷P04、P05、P10、P11继续PASS。

## 6. 全部本轮回归结果

| 套件 | 通过 | 失败 | 阻塞 |
|---|---:|---:|---:|
| 原Node | 79 | 0 | 0 |
| 第三阶段Node | 15 | 0 | 0 |
| 原浏览器功能回归 | 12 | 0 | 0 |
| 原审查14场景 | 14 | 0 | 0 |
| 第三阶段浏览器 | 10 | 0 | 0 |
| 第二阶段缺陷回归 | 9 | 0 | 0 |
| 第二阶段独立验收 | 32 | 0 | 2 |
| 新增专项Node | 4 | 0 | 0 |
| 新增专项浏览器 | 11 | 0 | 0 |
| 合计 | **186** | **0** | **2** |

自动化跳过0。2项阻塞仍为Firefox/WebKit二进制未安装，不是宣称通过；新增专项共15项。真实API按要求不执行，不混入已通过数量。修复前失败证据与最终结果分开保存，不用重跑次数重复累计。离线评估/干净重装本轮未另跑，不冒充新执行。

运行命令：

```bash
node --test tests/confirm-retry.test.cjs
node tests/confirm-retry-browser.cjs
npm test
npm run test:phase3:unit
node tests/browser.cjs
node tests/phase3-original.cjs
node tests/phase3-persistence.cjs
node tests/phase2-regression.cjs
node tests/phase2-independent.cjs
```

执行时清空DEEPSEEK_API_KEY，RUN_REAL_AGENT_TESTS=0。未运行test:real或check:deepseek。环境为当前Linux工作区、Node24.22.1/npm11.9.0、Playwright1.62.1、系统Chromium。

## 7. 剩余限制与结论边界

FA01专项已闭环，但并未引入后端用户计划数据库：实际计划仍由浏览器保存，服务端查询的是原任务提交回执状态。幂等状态仍依附现有内存会话；服务重启、会话过期、令牌缺失时返回未知，保留本机数据，不自动另建提交。真正跨服务重启的持久化恢复仍是K02，不属于本次已实现能力。

旧接口计算完成不等于落盘的K01、跨标签页/外部脚本写入的K03、存储配额限制及两个浏览器环境阻塞仍存在。刷新时会尝试恢复首个待确认远程任务；本轮未新增多任务恢复管理页面。没有匹配本机回执的中断草稿只查询/提示核对，不自动写入计划。

历史FINAL_ACCEPTANCE_REPORT.md与RELEASE_CHECKLIST.md保持原审查记录；本报告更新其中FA01结论，不自动授权版本冻结、发布或推送。

## 8. 交付与证据

- CONFIRM_RETRY_REGRESSION_RESULTS.json：逐套数量、逐项浏览器结果、前后哈希。
- reports/confirm-retry/：修复前失败、最终日志、源码完整性信息和confirm-retry.patch。
- 原始工作区证据：/workspace/reports/confirm-retry/，其中before/保留修改前四份源码。

补丁仅针对本次专项前的源码快照，不是早期2.1.1原始提交的全量补丁；不能忽略上一轮已有修改直接套用到旧HEAD。
