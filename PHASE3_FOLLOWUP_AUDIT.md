# 健康管家 2.1.1 第三阶段后续审查

日期：2026-11-21（Asia/Shanghai）。性质：**审查报告，不是修复交付**。本轮未修改业务源码、未提交或推送 Git、未再次调用真实模型 API。

## 一、结论

1. **新上传文件支持 Nutrition 和 Planning 已进行真实模型与工具联调的结论。** 两项均为 `model_and_tools`、`needs_confirmation`、`validation.valid=true`，`fallback=null`、`error=null`。不能再用旧 `not_run` 文件否定这次真实测试。
2. **Planning 的56条营养计算记录分成两段各28条，各接一个批量计算标记及计划校验。** 因此不能把56条记录解释为56次模型网络调用；文件明确记录模型请求仅7次。现有实现已支持批量计算与任务内缓存，并非尚未实现。
3. **缓存粒度存在实际缺口。** 完整批量参数一旦变化，整个批量缓存失效；批量内部没有逐餐共用该缓存。离线实验中只改1餐，第二批仍重算全部28餐，其中27餐未变。该实验说明机制，并不证明真实报告里恰好也只改了1餐。
4. **正常确认后的本地持久化、取消不提交、草稿与实际记录隔离均通过离线检查；故障持久化不可靠。** 存储失败仍提示已保存、部分写入导致计划集合和兼容计划不一致、日历保存失败后仍提示成功、异步确认期间上下文变化仍可保存旧计划，均已复现。本轮不修复。
5. **不应为减调用数删掉逐餐确定性计算或 Guardian 安全验证。** 建议优先修持久化一致性，再优化可信确定性结果的缓存与传输体积。

## 二、证据来源与版本边界

主证据是用户本机测试后上传的 `real-api-results.json`，原文件10737字节。已原样保存为：

- `/workspace/docs/real-api-results-2026-11-21.json`
- `/workspace/reports/phase3-followup/real-api-results-2026-11-21.json`

SHA-256：`5e4131823f906c702dcd49049fe6a38529aa554220b3429b5c7689e20cc10249`。

执行时间字段：`2026-11-21T05:54:48.801Z`，即上海时间13:54:48.801。根状态 `executed`，requests包含2项。工作区原先四份旧结果是 `not_run`，已排除。GitHub当前分支没有这份新结果，原先404不能解释为本机测试不存在。

审查源码：`/workspace/github/diccccc-phase2`，`package.json.version=2.1.1`，提交 `989fb1e2abd224712204db63672ab196bc96a3ec`。`index.html` 中的 Agent 内嵌模块与 `agent-core.js`、`agent-ui.js` 一致；本轮源码前后哈希一致。

**源码一致性结论：报告结构、字段、工具名及调用顺序与当前2.1.1实现相容，但不能证明本机执行文件逐字节等于该提交。** 新JSON没有源码哈希、commit SHA、具体模型/端点、运行配置、工具参数、完整计划、每轮消息、缓存标记或分轮用量。因此不能精确计算这次相同餐食的重复次数，也不能还原某次修订的具体原因。

`tests/real-api.cjs:2–4` 的真实测试入口检查密钥及 `RUN_REAL_AGENT_TESTS=1`，连接实际模型适配器，且自身没有注入mock；本轮**没有执行**该脚本或DeepSeek连接检查。报告视用户提供的本机结果为真实联调证据；仅凭这个汇总文件不能独立核验上游端点或HTTP响应原文。

## 三、真实调用链与Token

| 项目 | Nutrition | Planning |
|---|---:|---:|
| 模型调用 | 3 | 7 |
| steps记录 | 7 | 66 |
| Prompt Tokens | 3337 | 57295 |
| Completion Tokens | 135 | 14166 |
| Token总量 | 3472 | 71461 |
| mode | model_and_tools | model_and_tools |
| status | needs_confirmation | needs_confirmation |
| validation.valid | true | true |
| fallback / error | null / null | null / null |

两项合计10次模型调用、74933 Tokens。Planning的Prompt占其总Token约80.18%，总Token约为Nutrition的20.58倍。**这些数字来自上传文件，不是本轮产生的用量。** 文件没有prompt cache hit/miss、具体模型与计价档位，因此不能据此算出准确费用；Prompt高也不自动等于全部按未缓存价格计费。

### 3.1 Nutrition

| steps位置 | agent / tool |
|---|---|
| 1 | Nutrition / parse_meal_description |
| 2 | Nutrition / calculate_meal_nutrition |
| 3 | Nutrition / parse_meal_description |
| 4–5 | Nutrition / search_food_database ×2 |
| 6 | Nutrition / calculate_meal_nutrition |
| 7 | Guardian / validate_agent_result |

与 `agent-core.js:163–165,183–187` 相符：模型先参与解析/计算；模型结果items被作为输入后，本地 `nutrition()` 仍先解析文本和搜索，再用模型已验证items覆盖原items，然后确定性重算营养并经Guardian审核。这里存在**重复预解析/检索的优化空间**；最后的来源检查、营养重算和安全验证应保留。文件没有每轮tool_call_id，不能把7个steps逐一绑定到3个HTTP请求。

### 3.2 Planning：56的分解

以下是新JSON按原顺序编号的完整分组：

| steps位置 | agent / tool | 数量 |
|---|---|---:|
| 1 | Planning / get_current_stage | 1 |
| 2 | Planning / get_user_preferences | 1 |
| 3 | Planning / search_food_database | 1 |
| 4–31 | Planning / calculate_meal_nutrition | 28 |
| 32 | Planning / calculate_plan_nutrition | 1 |
| 33 | Planning / validate_meal_plan | 1 |
| 34–61 | Planning / calculate_meal_nutrition | 28 |
| 62 | Planning / calculate_plan_nutrition | 1 |
| 63 | Planning / validate_meal_plan | 1 |
| 64 | Guardian / validate_meal_plan | 1 |
| 65 | Planning / create_plan_draft | 1 |
| 66 | Guardian / validate_agent_result | 1 |

合计：56条逐餐计算＋2条批量标记＋3条计划校验＋3条读取/搜索＋1条草稿创建＋1条最终结果校验＝66条steps。

`server/deepseek-model.cjs:46–54` 的批量工具先逐餐调用已注册营养工具，完成后才追加批量标记，解释了“28条计算在前，批量标记在后”。批量Schema支持7天、每日最多4餐，因此**两轮7×4餐批量计算/修订是与轨迹高度一致的解释**。

但是，JSON只保留 `agent/tool/status` 三字段：

- 没有batch children数量、参数和summary，不能严格排除计算段混入批量前的单餐请求。
- 不知道两批是否改了份量、餐食、日期或仅顺序；不能声称真实样本中56条全是重复或全是必要重算。
- `completed`表示校验工具执行结束，不等于其返回的 `valid=true`；第一轮是否校验失败，文件没有保存返回结果，不能断言。
- `tests/real-api.cjs` 导出steps时丢弃 `cached` 标记；因此56是该工具名的完成事件数，不是已证明的56个唯一配方，也不能精确区分真实计算和缓存命中。
- 7次模型调用可能包含参数或输出纠正；`fallback=null`不等于没有内部重试。

在当前源码中，有有效模型plan且无base_plan时，`agent-core.js:185` 经过校验、草稿创建后直接返回。**此成功路径不会再执行本地 `planning()` 中的21餐显式工具循环（:176）**。所以不能不加条件地将这里解释为“模型35次＋本地固定21次”；该解释不符合当前成功分支。

当前默认模型请求预算48、实际执行预算64；批量子执行、缓存事件与后置校验是不同计量。66条steps并不证明超过64次模型阶段实际执行预算。

## 四、重复计算、上下文传输与现有缓存

### 4.1 批量计算和缓存已经存在

位置：`server/deepseek-model.cjs:8,15,16,36–58`。

- 已提供 `calculate_plan_nutrition`，不是要求模型为21/28餐分别发起21/28次HTTP请求。
- 每次modelLoop有独立Map，键为工具名加canonical(args)；对象键排序，数组顺序保留。
- 同一完整批量命中后不再次分发；但缓存结果仍完整放进模型消息历史。
- 批量内部通过invoke直接调用 `calculate_meal_nutrition`，**没有查询同一个Map中的逐餐键**。
- 相同配方在不同日期、不同批次中仍可能重复计算；只改1餐也会使整个batch键变化。

离线M01验证：相同21餐batch调用两次，只实际分发21次，第二次整批缓存命中。证明不能笼统判定“没有缓存”。

离线M02使用合成配方构造与上传结果**完全相同的steps三字段顺序**：7轮模拟模型回复、66条steps、56条营养计算、2个batch标记、最终待确认且校验通过。两批各28餐，第二批仅1餐改变，却仍重算28餐，27餐未变。该合成场景56次中只有17种完全相同参数签名，出现39次重复计算。**17/39是离线样例结果，不能代替真实样本的未知重复率。** 该实验没有调用真实API。

### 4.2 还有不计入steps的重复确定性运算

`agent-core.js:92` 的meal()调用nutrition()；`:113–114` 的validatePlan()又单独调用nutrition()读取warnings。因此每餐每次完整校验计算两次。

同一plan在模型validate、Orchestrator Guardian校验、create_plan_draft、状态转换guardResult、确认时校验、前端确认校验等边界可能多次重算。这些是**本地数学运算**，不等于又调用了真实模型，也不全都会产生新的steps或Token。

离线M03对源码文本仅在VM内存中插入计数器，未改源码文件。21餐样例：

| 场景 | nutrition()实际调用 |
|---|---:|
| 一次validatePlan | 42 |
| 模型输出后的三次完整验证 | 126 |
| 核心confirm中的两次完整验证 | 84 |

前端 `agentConfirm()` 还会再完整验证；不同最终餐次数值会不同，不能把上述样例数字套到这次真实报告。安全边界重验本身有价值，优化对象应是**重复算术和数据传输**，不是取消这些检查。

### 4.3 上下文重传与Token成本

位置：`server/deepseek-model.cjs:21–28,34,65,77`。

- 每轮请求重新序列化整个messages和工具Schema。
- messages保留之前的assistant工具参数及完整工具返回，随着计划修订增长。
- batch返回完整days、items、逐餐/每日/全周汇总；两次validate_meal_plan的工具参数又含完整plan，最终模型还需输出完整plan。
- 相同batch即便缓存命中，完整缓存结果仍再次追加到messages。因此**计算缓存命中不等于Prompt Tokens减少**。
- 没有通用的消息压缩、只传差异或计划引用协议。

离线M02中请求体从6100字节增长到51877字节；工具定义每轮2306个JSON字符。这里只是该样例的序列化体积，**不是Token计数，也不是这次真实HTTP请求大小**。它证明了增长机制，与真实Planning Prompt占比高相容，不能据此精确归因57295个Prompt Tokens的每一部分。

同时，`agentContext('planning')` 默认不带实际饮食/体重历史，发送后端前删除foods，初始模型消息也没有直接序列化整个context。**没有证据表明此Planning默认每轮向模型重发完整用户健康历史。** 重发的主要是system/schema、任务/约束和已经获取的工具会话内容。

前端300ms轮询任务的开销属于浏览器—本地后端通信，不应混算为模型Prompt Tokens。

## 五、确认、取消和隔离

### 5.1 当前保存链路

1. `create_plan_draft` → engine.drafts内存Map；结果 `needs_confirmation`。不是正式计划落盘。
2. 用户确认 → `Orchestrator.confirm()` 重验 → `apply_confirmed_plan` 返回 `aiPlan:true,requires_local_commit:true` → 核心任务completed。
3. 前端 `agentConfirm()` 再验 → 写 `hm_agent_plans_v1`、兼容 `hm_ai_week_plan`、接受记录/偏好记忆。这才是浏览器本地持久化。
4. “加入日历”是另一次明确操作，写入条目带 `aiPlan:true`。实际摄入和TDEE排除这些条目。
5. 用户再明确将某条草稿“记为实际”，才移除aiPlan并计入实际摄入。

关键位置：`agent-core.js:156–157,198–202`；`agent-ui.js:105–121,158–159`；`index.html:3441–3449,4306–4311,6857–6866`。

**后端会话、任务与drafts是内存，不是数据库持久化。** 用户正常确认的计划保存于当前浏览器同一origin的localStorage；本报告不将其称为服务端永久存储或跨设备同步。

上传的真实JSON停在needs_confirmation，而且测试脚本没有执行confirm。**该真实结果证明生成和校验完成，不能证明用户确认后的真实计划已经保存。** 以下保存结果来自本轮隔离浏览器的合成计划验证，未冒充对上传真实计划的确认重放。

### 5.2 正常路径与取消检查

| 用例 | 结果 | 检查内容 |
|---|---|---|
| P01-confirm-and-reload | PASS | 确认后AGENT_PLANS与兼容周计划均持久化；实际记录不增加 |
| P02-reject | PASS | 拒绝待确认计划不写正式计划、兼容计划、实际记录 |
| P03-cancel-before-confirm | PASS | 先取消再确认不能落盘 |
| P04-all-storage-fails | FAIL | 写入失败不能显示计划已保存或完成持久化 |
| P05-selective-plan-storage-fails | FAIL | 正式计划集合失败时不能另存兼容计划并显示成功 |
| P06-double-confirm | PASS | 并发双击确认最多保存一次计划 |
| P07-cancel-during-confirm | PASS | 确认等待工具时取消后不保存计划 |
| P08-calendar-draft-isolation | PASS | 已确认计划入日历仍是aiPlan，统计与TDEE不读取 |
| P09-dismiss-calendar-confirm | PASS | 取消加入日历确认不写日历，不撤销此前已确认计划 |
| P10-calendar-write-fails | FAIL | 日历写入失败不显示加入草稿成功 |
| P11-stale-during-await | FAIL | 确认请求等待期间上下文变化后应阻止旧结果持久化 |
| P12-reject-preserves-previous-plan | PASS | 拒绝新草稿不会覆盖之前已确认计划 |
| P13-explicit-actual-conversion | PASS | 仅用户明确将某个草稿条目标为实际后才计入摄入 |
| P14-cancel-reload | PASS | 取消后刷新不会恢复为已确认计划或实际摄入 |

正常确认后刷新可读到计划；拒绝或先取消待确认任务不会写正式计划/实际饮食；确认等待工具时取消也阻止保存。取消“加入日历”只是不创建日历草稿，不撤销此前已经明确保存的计划。拒绝新草稿能保留之前已确认计划。取消后仍可能保存任务历史/取消状态，不能误称“任何存储都不写”。

隔离样例：84个食材级草稿条目，实际条目0、实际热量0、TDEE有效记录天数0；仅手动“记为实际”一个条目后，实际条目1、有效天数1。84是食材条目数量，不是84餐。

### 5.3 未修复发现

#### F01 / P1：计划保存失败或部分失败仍提示成功

位置：`index.html:2116` lsSet()吞异常；`:4311` saveWeekPlan()不验证落盘；`agent-ui.js:112–113` 多键写入没有检查或事务回滚。

复现：隔离浏览器中生成待确认计划，在确认前让Storage.setItem抛QuotaExceededError，再确认。

- P04：正式计划0、兼容周计划null、核心task completed，仍提示“已保存用户确认的结果”。
- P05：只令hm_agent_plans_v1写入失败，正式计划0、兼容周计划却存在，仍提示成功。

核心completed表示编排完成，本身不能作为落盘成功证据。故障结论主要依据**明确成功提示与重新读取为空/不一致**。建议引入写入返回值、读后校验、提交版本号及失败恢复；不能以未检查的setItem调用次数证明持久化成功。状态：OPEN，本轮未修复。

#### F02 / P2：日历保存失败后仍提示加入草稿成功

位置：`agent-ui.js:121` agentCalendarPlan()忽略saveDiary返回值。

复现：确认计划后，仅令hm_diary写入抛QuotaExceededError，点击加入日历并同意。

P10：diary仍为空，先提示保存失败，随后又提示“计划已作为草稿加入日历，未计入实际摄入”。建议只在保存成功并回读一致后显示成功。状态：OPEN。

#### F03 / P2：确认前的指纹检查存在异步窗口

位置：`agent-ui.js:107–112`：fingerprint只在await confirm之前比较，await之后没有再次比较或绑定版本。

复现：让确认过程在工具执行处等待；等待期间保存新的体重79.9；再释放工具继续确认。

P11：当前上下文已改变，但旧计划仍写入正式计划集合，task completed。后续validatePlan虽重验当前安全边界，并不能保证与生成时上下文相同；此例仍在允许范围内，所以通过校验并保存。

建议将生成版本与确认版本绑定，保存前二次检查，并在服务端/客户端明确处理中状态和取消语义。状态：OPEN。本轮没有发现被确认取消的任务仍写正式记录；这是另一类上下文过期竞态，不应混称取消失败。

## 六、批量与缓存可行性及安全前提

| 建议 | 可行性 | 必须保留的约束 |
|---|---|---|
| 批量内部逐餐memoization | 高；当前主要缺口 | 相同food_id/精确grams/数据库版本/生熟状态/算法版本才能复用；不能为提高命中率先改变克重精度 |
| 校验内复用meal()已算出的warnings和totals | 高 | 同一受信任计算结果同时用于比较与警告；不得信任模型自报数字 |
| 修改单餐时仅重新计算受影响餐与汇总 | 高，但需定义版本协议 | 最终仍完整检查Schema、日期、来源、预算、忌口、时间、能量/宏量区间 |
| 用紧凑batch结构、差异/引用减少重传 | 可行，但需端到端协议设计 | 引用必须绑定不可变计划版本与上下文，不可丢失工具来源和错误信息 |
| 跨任务缓存 | 需谨慎 | 不仅按food_id；变更数据库/算法/状态即失效，限制容量；价格/准备时间/偏好相关结果需纳入对应上下文版本 |
| 取消Guardian、用模型估计代替确定性计算、粗化份量 | 不可接受 | 会降低安全与精度，不能作为减调用方案 |

现有canonical()只排序对象键，不排序数组。未来缓存要先保持完全相同的输入语义；不能未经浮点累加/舍入测试就将食材重排、合并或降低grams精度。

优先优化完整批量参数中不影响营养的日期/顺序变化造成的无效重算；分离纯营养缓存与价格/准备时间计算。确认边界的安全重验必须在当前上下文进行。共享结果只可来自可信确定性计算器，不能用模型输出的nutrition_totals填充缓存。

纯营养算术通常远比模型网络调用便宜。即使本地计算次数下降，也不能直接宣称Tokens或费用同比下降；还必须减少重复工具参数/结果和完整计划序列化，并在后续获授权的真实测试中测量。当前报告不作未经验证的节省百分比承诺。

## 七、后续观测与验收建议

下一次真实测试应记录：源码commit/核心文件哈希、实际模型和端点标识（不记录密钥）、模型轮次和tool_call_id、batch_id与子调用关系、输入/输出摘要哈希、缓存命中、model_budget、model_contribution、逐轮usage及供应商cache hit/miss（如提供）、模型返回的计划ID/版本和每轮validate_meal_plan的valid/issues摘要。

在保证隐私和用户授权的本地证据中保存足够参数，才可判断56次中哪些餐食相同、为什么第二次修订。不要把完整健康资料或密钥直接加入公开日志。

实施顺序建议：

1. F01/F02可靠写入与成功反馈、F03确认版本竞态。
2. 逐餐精确缓存，保留全部安全验证；对重复批量、只改1餐、相同单位但状态不同、数据库版本变化做对照测试。
3. 校验内复用、请求/结果紧凑化；保留失败解释与完整最终计划校验。
4. 先通过模拟回归，再单独获授权开展真实API成本对照；本轮不执行。

## 八、本轮执行与证据

| 层级 | 执行数 | 通过 | 失败 |
|---|---:|---:|---:|
| 模拟模型/内存插桩探针M01–M03 | 3 | 3 | 0 |
| 隔离浏览器持久化/取消/隔离P01–P14 | 14 | 10 | 4 |
| 原有core/model-limits离线测试 | 38 | 38 | 0 |
| **本轮本地检查合计** | **55** | **51** | **4** |

另读取用户提供的2项既有真实任务结果，没有把它们算成本轮新执行。没有再次运行全套第二阶段验收，也没有虚构对真实计划确认的端到端结果。

环境：Linux、Node24.22.1、Playwright1.62.1、系统Chromium，浏览器上海时区。浏览器测试所有/api请求均拦截；被阻断的是自动发起的本地/api/ai/health探测，不是供应商模型请求。模拟模型探针完全替换fetch返回；VM仅修改内存中的代码文本作计数。所有测试使用合成数据和隔离浏览器存储。

证据目录：`/workspace/reports/phase3-followup/`。

- `real-api-results-2026-11-21.json`：新上传原始真实联调结果。
- `nutrition-trace-analysis.json`、`planning-trace-analysis.json`：原始steps分组统计。
- `model-probes.cjs`、`model-probe-results.json`、`model-probes.log`：离线批量/缓存/计数实验。带MOCK_ONLY标识，不是新增真实调用。
- `model-probe-results-count-equivalent.json`：早期计数相同的合成样例，最终采用与上传steps顺序一致的实验结果。
- `persistence-probes.cjs`、`persistence-probe-results.json`、`persistence-probes.log`：正常和故障保存、取消、隔离复现。
- `existing-offline-tests.log`：`DEEPSEEK_API_KEY='' RUN_REAL_AGENT_TESTS=0 node --test tests/core.test.cjs tests/model-limits.test.cjs`，38通过。
- `AUDIT_RESULTS.json`：本轮结构化结论与失败实际值。
- `source-before.json`、`source-integrity.json`：源码哈希保全和内嵌模块一致性。

**最终状态：真实联调证据已核对；调用效率存在可优化点；正常路径可用，但持久化可靠性仍有OPEN问题。本轮仅报告，不修改源码、不重新调用API、不提交或推送。**
