# 第二阶段代码变更记录

修复前主版本2.1.0，修复后2.1.1。业务改动采用函数级局部修改，图片资源及整体界面保留。

- **B01**：统一范围校验与持久化前验证；补录和模板同样拒绝。 文件：index.html；函数：nutritionEntryError, diaryValidationError, saveDiary, comboItemNutrition, addCustomEntry, backfillEntry, saveCombos。
- **B02**：有限数/单项/合计校验；旧异常合计标待补；失败自定义餐不另存食物库。 文件：index.html；函数：foodNumberError, nutritionEntryError, diaryValidationError, saveDiary, todayTotals, addCustomEntry。
- **B03**：只复用既有明确单一单位参考份量；米饭勺/歧义单位/未知食材单位要求g；份量标估算。 文件：index.html；函数：foodUnitConversion, comboItemNutrition, addComboToDiary。
- **B04**：忙状态禁用按钮、成功表单指纹、明确反馈、再记一份重置令牌。 文件：index.html；函数：addComboToDiary, newComboSubmission。
- **B05**：共享recordDateError及持久化日期校验；Agent validDate同步范围；日期控件设边界。 文件：index.html, agent-core.js；函数：recordDateError, diaryValidationError, editQuickMeal, saveWeight, HealthAgents.validDate。
- **B06**：自由文字无法可靠重算时清空宏量营养，删除旧foodId/grams及来源；非营养编辑保留原数据。 文件：index.html；函数：editQuickMeal。
- **B07**：校准窗口内实际记录和体重确定性快照指纹；证据变更标historical，时效失效标expired，当前为current。 文件：index.html；函数：calibrationFingerprint, calibrationFresh, effectiveTDEE, recalibrateTDEE。
- **B08**：saveProfile默认保留start；独立重启按钮解释影响、经确认重置日期，保留历史。 文件：index.html；函数：saveProfile, btnRestartPlan click handler。
- **B09**：写输出前mkdirSync recursive；两套不同干净副本测试退出0并核对输出字段。 文件：tests/evaluate.cjs；函数：tests/evaluate.cjs top-level evaluation。
- **N01**：本地日历日期映射UTC日序，阶段1。 文件：index.html；函数：stageIndexByDate, currentStage。
- **N02**：未完成摘要转cancelled，保存PAGE_INTERRUPTED原因。 文件：index.html, agent-ui.js；函数：initAgentUpgrade。
- **N03**：仅读取一次，3650天刷新通过15秒上限测试。 文件：index.html；函数：computeStreak。

其他交付变更：package.json增加测试入口、版本号；package-lock.json锁定测试依赖；README说明边界与测试；新增两个自动化脚本；文件校验.json刷新哈希；docs采用最终测试生成结果。

## 修改/新增文件

- `README.md`（modified）。
- `agent-ui.js`（modified）。
- `agent-core.js`（modified）。
- `package.json`（modified）。
- `index.html`（modified）。
- `package-lock.json`（added）。
- `tests/phase2-independent.cjs`（added）。
- `tests/phase2-regression.cjs`（added）。
- `tests/evaluate.cjs`（modified）。
- `文件校验.json`（更新交付清单）。
- `docs/`（最终浏览器截图与测试/评估结果，非业务代码）。

精确差异：`evidence/source-changes.patch`；修改文件哈希：`evidence/code-changes.json`；全部交付文件哈希：`evidence/source-hashes-after.json`。

已同步到 `/workspace/work/agent-upgrade` 的运行源码、模块和测试入口；未修改线上静态发布目录，未部署。同步范围见 evidence/development-sync.json。
