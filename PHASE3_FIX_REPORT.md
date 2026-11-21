# 健康管家 2.1.1 第三阶段第二轮修复与验收

审查日期：2026-11-21（上海时间）。本轮只修改本地工作副本，未调用真实 DeepSeek API，未发布、未推送。

## 1. 基线与修复计划

已完整阅读 `PHASE3_FOLLOWUP_AUDIT.md`，检查原始浏览器证据、当前源码和调用链。修复前基线为提交 `989fb1e2abd224712204db63672ab196bc96a3ec`，`reports/phase3-fix/source-before.json` 中各项 SHA-256 与该提交一致。原始真实联调 JSON 的版本证据边界保持不变：它没有源码哈希，不能据此证明用户本机解压版逐字节相同。

修改业务代码前已输出计划并保存基线：先复现四项失败，建立存储、两阶段确认及逐餐缓存测试；再最小范围修改；保留原有食物计算、Schema、Guardian 和计划/实际隔离；最后在独立干净目录重跑。没有修改或删除原有测试源码，静态校验见 `independent-static-checks.json`。

## 2. 四项原始失败的对应关系

| 原用例 | 原始复现及实际结果 | 修复后要求/结果 | 代码与函数 | 状态 |
|---|---|---|---|---|
| P04-all-storage-fails / F01 / P1 | 在确认前让所有 `Storage.setItem` 抛配额异常；计划0、周计划null，但任务 completed 并提示已保存 | 不写业务数据、不提示成功，草稿可重试；原用例 PASS | `agent-ui.js:112 agentConfirm`；`agent-storage.js:9 transaction`；`agent-core.js:206 commitReceipt` | VERIFIED（页面两阶段协议） |
| P05-selective-plan-storage-fails / F01 / P1 | 只拒绝 `hm_agent_plans_v1` 写入；正式计划0，但兼容周计划存在，仍提示成功 | 计划、兼容计划、接受记录与回执作为一个提交；任一失败回滚；原用例 PASS | 同上；事务日志 `recover/read/write` | VERIFIED（应用读取视图与恢复） |
| P10-calendar-write-fails / F02 / 原P2 | 成功确认后只拒绝 `hm_diary` 写入；日历空，同时出现失败和加入草稿成功提示 | 检查 `saveDiary()` 返回值，失败立即结束；整批日历条目一次校验保存；原用例 PASS | `agent-ui.js agentCalendarPlan`；`index.html saveDiary/addPlanDayToDiary` | VERIFIED |
| P11-stale-during-await / F03 / 原P2、本轮P1 | 暂停确认工具的 yieldControl；修改今日体重后继续；旧计划仍存入且任务 completed | 等待前、等待后及事务每个写入边界检查生成快照；明确指出变化类别并拒绝旧草稿；原用例 PASS | `agent-ui.js agentFingerprint/agentAssertCurrent/agentConfirm` | VERIFIED（本应用入口） |

原始14项脚本保留原断言，作为 `tests/phase3-original.cjs` 可重复运行。修复前结果为10 PASS、4 FAIL，见 `original-before.json`；修复后及干净目录复跑见回归 JSON。F01覆盖两项失败，所以“四项失败”对应三类原始缺陷。

## 3. 实现说明

### 写入与确认

页面显式发送 `defer_commit=true`，核心先完成全部原有校验、生成带唯一 ID 的确认凭据，保持 `needs_confirmation / commit_pending`。页面构造全部业务更新，用独立日志键暂存写前/写后值，逐项写入并回读校验，最后提交日志标记。只有本机提交已验证并完成 `/commit` 回执，页面才提示保存成功。

提交前失败：恢复写前值；回滚暂时失败则保留日志，本应用读取旧值，下次写入/启动前恢复。提交标记后清理失败：保留提交日志，启动时完成新值恢复。原来的计划数组、周计划、饮食及偏好数据格式没有迁移；新增日志和回执为独立辅助键。

页面防双击、同任务确认凭据、持久化回执及核心并发确认/回执去重共同防止重复保存。写入后回执失败时明确显示“本机已保存，状态未同步”；重试复用回执，不再次写入餐食/计划。刷新时区分本机已提交与尚未提交的中断任务。

后端持久化适配器异常返回 `503 / success=false / PERSISTENCE`；上下文版本冲突或过期返回409。测试中用故障适配器模拟后端写失败；现有生产后端本身没有用户数据数据库，本轮没有虚构服务端数据库写成功。

**兼容边界：**旧调用方未选择两阶段模式时仍保留原计算确认协议，`completed` 同时明确带 `persistence_status=not_requested` 与 `requires_local_commit=true`，不能解释为持久化成功。所有本次页面入口使用新协议；旧调用方迁移仍列为 K01，未宣称全协议已收敛。

### 草稿依据与取消

生成时页面保存饮食、体重、档案/目标、消耗校准、饮食偏好、日期及计算阶段快照；核心任务另有会话版本和24小时有效期。确认期间比较真实快照，不仅比较时间；变化提示包含类别。取消/换任务会阻止写入，已提交回执不能再通过“取消”误称未保存。模拟方案选择必须与本任务草稿匹配。

### 批量缓存

在现有批量计算和整请求缓存之外，增加任务内逐餐缓存。键包含完整食物版本、计算版本、精确有序食材和原始份量，不量化或舍入缓存键。第二批仅修改一餐时，保留未受影响餐的结果，只实际调用变更餐；缓存步骤含 `cached` 与 `cache_source`。食物版本变化会失效。成本和准备时间仍按本次约束重算，完整 Schema、营养重算和 Guardian 审核均保留。

冷启动批次仍逐餐实际执行，保留原有预算和审计测试标准。本轮没有合并跨用户/跨任务缓存，也未删减最终验证。离线28餐×2批、第二批只改一餐的测试：实际工具计算56→29（28+1），复用27；这不是对原真实 JSON 的重复次数或真实 Token 降幅的推断。

### 独立复查发现的额外问题

R07：保存失败后，核心对象仍带候选 `confirmed_action.plan`；直接调用加入日历函数原可旁路新增草稿。新增测试先出现 FAIL，再给该函数加任务完成状态、匹配回执和已保存计划三项校验。此修复不改变实际摄入隔离规则。

## 4. 自动化验收与复现命令

```bash
npm ci --ignore-scripts --cache /workspace/npm-cache
npm test
npm run test:browser
npm run test:phase2
npm run test:acceptance
npm run test:phase3:unit
npm run test:phase3:original
npm run test:phase3:browser
npm run evaluate
```

执行时清空 `DEEPSEEK_API_KEY`、设置 `RUN_REAL_AGENT_TESTS=0`。模型测试只替换本地 fetch 返回模拟上游数据；存储故障测试明确注入异常；浏览器故障脚本阻断所有 `/api/**` 请求，HTTP集成只访问127.0.0.1。没有运行 `test:real` 或 `check:deepseek`。

实际环境：Linux、Node v24.22.1、npm11.9.0、Playwright1.62.1、系统 Chromium；正常浏览器场景含上海时区，第二阶段独立脚本包含其已有时区/异常用例。干净副本位于 `/workspace/reports/phase3-fix/clean-delivery`，没有复制 `.git`、node_modules、真实 `.env`；重新 npm ci 后执行全部上述本地检查。首次使用默认 npm 缓存路径时遇不可写错误，随后指定工作区缓存成功，未修改依赖版本。

最终用例数量、每套退出码和已知阻塞以 `PHASE3_REGRESSION_RESULTS.json` 为准。原有测试断言未修改；新增用例含原始缺陷复现和补充故障/并发验收，修复前日志保留。缓存测试的餐次夹具曾因共享引用同时改到两餐，已修正为独立食材副本，并在基线副本重新确认失败；没有降低断言标准。

## 5. 修改文件与关键位置

- `agent-storage.js`：新增日志、回读、恢复和事务视图。
- `agent-core.js:197`：准备确认、会话版本、过期拒绝、确认/回执并发去重、持久化状态。
- `agent-ui.js:7`：生成快照；`agentAssertCurrent/agentConfirm`：阶段式提交和重试；`agentCalendarPlan`：失败返回与回执校验；`initAgentUpgrade`：刷新后的状态披露。
- `index.html`：同步三份内嵌模块；`lsGet/saveDiary/saveWeekPlan/runWeekPlan/addPlanDayToDiary`：恢复视图、返回值、旧计划保存依据检查、整批提交。
- `server/agent-router.js:19`：新增commit路由、错误HTTP状态。
- `server/deepseek-model.cjs:15,49`：逐餐缓存、版本键、准确实际调用预算和来源步骤。
- `package.json`：新增三个可复现的phase3测试命令。
- `tests/phase3-*.test.cjs`、`tests/phase3-original.cjs`、`tests/phase3-persistence.cjs`：新增自动化；原79项、原浏览器和第二阶段脚本均未改动。

源码前后哈希、补丁、修复前后日志、浏览器JSON和干净目录运行记录保存在 `reports/phase3-fix/`；工作区原始证据仍保留 `/workspace/reports/phase3-fix/`。补丁为 `source-changes.patch`，不包含密钥。

## 6. 验收结论的范围

本轮验证页面计划/记餐确认、故障回滚与恢复、幂等重试、依据变化拒绝、取消、草稿/实际隔离及精确批量复用。不得将结论扩展为服务端任务跨重启恢复、旧客户端全面迁移或所有浏览器均可用。剩余事项、Firefox/WebKit阻塞及真实API禁测单列于 `PHASE3_KNOWN_ISSUES.md`。未发布线上版本。

## 最终执行数量

| 测试套件 | 通过 | 失败 | 阻塞 |
|---|---:|---:|---:|
| original-node | 79 | 0 | 0 |
| phase3-unit | 15 | 0 | 0 |
| original-browser | 12 | 0 | 0 |
| phase2-regression | 9 | 0 | 0 |
| phase2-independent | 32 | 0 | 2 |
| phase3-original | 14 | 0 | 0 |
| phase3-browser | 10 | 0 | 0 |

自动化共 171 通过、0失败、0跳过、2阻塞。新增25项（15项Node、10项浏览器）；另保留原审查14项。静态核查6项全部通过；10段内嵌脚本语法解析通过。真实API按要求排除，不混入自动化跳过数量。

干净目录9个命令全部退出0，包括重新安装、原79项、原浏览器12项、第二阶段9+32项、第三阶段15+14+10项及离线评估脚本；Firefox/WebKit两项环境阻塞仍保留。评估脚本只记录实验结果，退出0不代表其中所有识别率为100%。

最终独立浏览器验收确认 R07 由失败变为通过。未发现本轮新增的已复现高优先级页面回归；K01～K06仍然披露，不能宣布所有部署及旧客户端场景全部完成。
