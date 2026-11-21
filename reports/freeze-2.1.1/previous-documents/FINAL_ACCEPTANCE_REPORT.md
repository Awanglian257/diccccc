# 健康管家 2.1.1 最终交付审查

日期：2026-11-21（上海时间）
结论：**暂不建议冻结 2.1.1。** 四项原始缺陷在当前页面路径均有修复与回归证据，但新增 FA01 显示“服务端已提交、响应丢失”后的页面重试不能收敛。该项属于本轮承诺的确认可靠性范围，作为冻结门槛待解决。本报告未修改业务源码、未新增 Agent、未调用真实 API、未发布或推送。

## 1. 审查依据与完整性

工作目录 `/workspace/github/diccccc-phase2`，基线提交 `989fb1e2abd224712204db63672ab196bc96a3ec`。阅读第三阶段审查、修复、已知问题、回归 JSON、故障脚本及修改后的核心调用链；对照 Git 差异核查全部业务改动。七份交付源码哈希全部与上一轮 `PHASE3_REGRESSION_RESULTS.json.source_hashes` 一致。三份内嵌模块与独立文件一致，10段内嵌脚本可解析；Agent 注册清单未变。

源码修改仍未提交，包含新增未跟踪文件，不能仅使用 `git diff` 导出交付。已有 `reports/phase3-fix/source-changes.patch` 包含新增模块和测试，前轮对基线的 apply --check 证据保留；冻结时仍应固定全部文件与哈希，而非只标注旧 HEAD。

## 2. 所有源码修改及影响范围

| 文件 | 修改与影响 | 审查结论 |
|---|---|---|
| agent-storage.js（新增） | 多键日志、回读、旧值读取视图、提交/回滚恢复；影响所有接入该辅助层的本机读写 | 可恢复应用事务，不是数据库原生事务；跨标签页边界仍存在 |
| agent-core.js | 新增确认凭据、24小时过期、延迟提交、回执状态及并发去重 | 页面新协议避免提前完成；旧协议保留，FA01跨步骤重试遗漏 |
| agent-ui.js | 快照重验、两阶段保存、原子业务更新、回执去重、日历入口防绕过、刷新状态披露 | 四项原失败已覆盖；回执成功响应丢失后重试有缺口 |
| index.html | 同步三模块；lsGet恢复视图、saveDiary/saveWeekPlan返回值、旧七日计划快照、整批日历写入 | 影响普通饮食记录及历史读取，不只是Agent页面；已有回归支持，但不能承诺任意外部历史文件均兼容 |
| server/agent-router.js | 增加commit端点、传递延迟确认选项、503/409响应 | 现有授权和同源限制保留；服务器没有新增持久化数据库 |
| server/deepseek-model.cjs | 全请求缓存纳入上下文版本、任务内精确逐餐缓存、预算统计及来源步骤 | 未降低Schema/Guardian检查；真实请求构造及配置变量未改；未测真实性能 |
| package.json | 增加三个phase3测试命令 | 原测试命令、依赖版本和锁文件未变 |
| tests/phase3-{confirm,storage,http,cache}.test.cjs；tests/phase3-{original,persistence}.cjs | 新增15项Node、10项浏览器验收，另移植原14场景 | 故障模拟和模拟模型上游有明确标注，无跳过/only/todo调用 |

支持文件 `server/start.cjs`、`server/server.js`、`server/.env.example`、`package-lock.json`、`server/foods.json`、`server/legacy-tdee.js` 与基线逐字节一致。

## 3. 四项原始缺陷对应核实

| 用例 | 原始问题 | 修复代码与回归 | 本轮结果 |
|---|---|---|---|
| P04-all-storage-fails | 所有写入失败仍completed/提示成功 | agentConfirm→agentPersist→transaction；deferred confirm→commitReceipt；原P04及storage/confirm单测 | PASS |
| P05-selective-plan-storage-fails | 正式计划失败但兼容计划另存成功 | 日志原子更新计划、周计划、偏好及回执；原P05、R01及事务回滚测试 | PASS |
| P10-calendar-write-fails | saveDiary失败仍提示加入成功 | agentCalendarPlan检查布尔结果；saveDiary整批校验写入；原P10、R04、R07 | PASS |
| P11-stale-during-await | 异步等待期间资料改变仍保存旧草稿 | agentFingerprint/agentAssertCurrent在等待前后和提交边界重验；原P11、R03三类修改、版本/过期单测 | PASS |

本轮重新执行原14个浏览器场景，全部通过。以上结论针对新页面保存路径；不得据此称所有旧协议调用方都已实现持久化确认。

## 4. 测试真实性与数量

上一轮记录的171 PASS、0 FAIL、2 BLOCKED、0自动化SKIP经JSON/日志与交付哈希核对一致，分布为：原Node79、原浏览器12、第二阶段9+32、第三阶段15+14+10。前轮干净安装和9个命令退出0的记录存在。未把这些记录冒充本轮全量重新执行。

本轮实际重新执行：

| 套件/探针 | 通过 | 失败 | 备注 |
|---|---:|---:|---|
| npm test | 79 | 0 | 原命令 |
| npm run test:phase3:unit | 15 | 0 | 确认、存储、HTTP、缓存 |
| npm run test:phase3:original | 14 | 0 | 原始14场景 |
| FA01 响应丢失探针 | 0 | 1 | 新发现，离线浏览器故障注入 |
| 本轮合计 | 108 | 1 | 不与前轮重跑重复累计 |

原有测试源码对照HEAD均未修改，原测试命令未减少；新增phase3脚本未发现skip/only/todo跳过调用。第二阶段其他套件本轮核对已有证据，未再次全量执行。没有发现删断言或降低标准的证据。此前缓存夹具修正共享引用有说明，当前断言仍要求29次实际计算及27次有来源复用。

模拟严格区分：缓存测试使用 `mock-only` 并替换fetch，HTTP测试只访问本机，存储测试注入失败适配器，故障浏览器阻断 `/api/**`。这些只证明离线协议/算法，不构成真实模型成功证据。FA01同样模拟传输丢包，实际运行当前页面保存逻辑与真实核心状态机。历史真实联调JSON仍仅作旧证据，未重新请求模型。

## 5. 新发现 FA01：提交成功响应丢失后重试不能完成

状态 OPEN；严重程度 P2（状态恢复/可用性）；**当前冻结验收阻断项**。没有观察到数据重复或数据丢失，但它违反“状态同步失败后可重试”的明确承诺。

源码位置：`agent-ui.js:118–137 agentConfirm.execute`；`agent-core.js:198 prepareConfirmation`；HTTP入口 `server/agent-router.js:22`。ACK本身在核心 `commitReceipt` 内幂等，但页面重试先走了不可重复的prepare。

复现：

1. 生成本地七日候选计划，用离线远程传输适配器接到同一核心状态机，关闭其直接页面onUpdate（模拟真实远程边界）。
2. 首次点击确认；本机计划与回执成功提交。
3. `/commit` 在核心执行成功、任务转为completed之后，模拟丢失HTTP响应。
4. 页面仍保持needs_confirmation并提示重试。再次点击确认。
5. 页面有本机回执，却仍先请求 `/confirm`；后端已completed，prepareConfirmation拒绝，第二次commit未发生。

实际：frontend=needs_confirmation，backend=completed，plans=1，confirm调用2次，commit调用1次。预期：复用回执直接重发commit或查询已完成状态，最终页面completed且plans仍为1。

可复现脚本 `/workspace/reports/final-acceptance/response-loss.cjs`，结果 `response-loss.json`，退出码1。脚本使用模拟传输故障，不需要API Key。修复建议仅为审查意见，本轮未改源码：已有匹配本机回执时绕过重新prepare，并验证任务/凭据后幂等完成；增加端到端“服务端成功后响应丢失”回归，而不是仅模拟服务端抛错。

## 6. 浏览器阻塞与剩余协议限制

两项阻塞均为浏览器二进制缺失，当前文件存在性复核仍为false：

- ENV-Firefox：`/home/agent/.cache/ms-playwright/firefox-1538/firefox/firefox`。
- ENV-WebKit：`/home/agent/.cache/ms-playwright/webkit-2336/pw_run.sh`。

它们不是已观察到的页面功能失败；原脚本仅设计启动/首页冒烟，不能把“补齐后冒烟通过”描述为全浏览器完整回归。

旧协议：未传defer_commit时confirm仍返回completed + not_requested + requires_local_commit。现页面显式新协议，但外部旧客户端迁移没有完成证明。后端session、草稿、任务是Map，重启即丢失；浏览器本机计划/回执不会因此自动消失，但旧远程任务无法续接。刷新后的local_persisted只代表本机保存，不代表远程ACK恢复。细项见 FINAL_KNOWN_ISSUES.md。

## 7. 真实API配置与回归边界

配置模板、启动加载器、依赖锁文件未改。DeepSeek的KEY/BASE_URL/MODEL环境变量名称、Authorization构造、请求路径、temperature/输出预算及授权入口没有被本轮缓存改动替换；不存在生产分支硬接Mock结果的修改。适配器仍对模型/工具结果执行原有校验。

本轮未读取或输出真实Key，未测试线上连通性、余额、模型可用性或最新Token消耗。因此结论为“配置接口静态未见破坏”，不是“真实API已复测成功”。

实际摄入与aiPlan隔离、删除/修改后统计、TDEE及阶段连续性有前轮原套件和本轮原14场景支持；数据格式主体不迁移，新增辅助键。没有检查用户设备上的真实完整历史库，不能绝对确认所有历史数据或所有异常迁移无回归。新日志影响全局读取及配额，跨标签页、外部旧页面直接写入仍非数据库级事务。现有Agent工作流正常回归通过，但FA01证明不能给出“所有工作流均无回归”的无条件结论。

## 8. 冻结决策与证据

**HOLD：当前不建议冻结2.1.1为最终交付版本。** 首先修复FA01并跑服务端已成功/响应丢失的端到端回归及原相关套件；明确旧协议与重启边界的交付范围，再决定是否有条件冻结。Firefox/WebKit可在明确仅支持Chromium的交付范围中披露，不必假称已通过。

三个交付文档为本报告、FINAL_KNOWN_ISSUES.md、RELEASE_CHECKLIST.md。本轮证据复制至 `reports/final-acceptance/`，原始证据保留 `/workspace/reports/final-acceptance/`，前轮报告和结果未改写。此结论没有自动授权发布、推送或创建版本标签。
