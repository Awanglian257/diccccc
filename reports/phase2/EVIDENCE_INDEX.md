# 证据索引

所有路径以 reports/phase2 为根；JSON报告中的绝对路径指当前工作区。审查归档不包含浏览器下载、npm缓存和已安装node_modules。

## 第一阶段与修复前

- evidence/phase1/TEST_AUDIT_REPORT.md：第一阶段完整报告。
- evidence/phase1/source-hashes-before.json：第一阶段源文件指纹。
- evidence/version-comparison.json：本轮修改前逐文件比对，三个目录无差异。
- baseline/project/：原始43文件快照。
- evidence/batch1-before.json至batch4-before.json：九个原始失败用例。
- evidence/additional-before.json：夏令时、刷新任务原始失败。
- evidence/large-history-before.json：重复解析回归失败；acceptance-pre-final-discovery.json记录大数据刷新超时。
- evidence/legacy-aggregate-before.json、entry-paths-before.json、custom-atomicity-before.json、unknown-unit-before.json：独立发现的入口与旧数据遗漏。

## 修复中与修复后

- evidence/batchN-after.json与batchN-original.log：每批新增测试及原有79项回归。
- evidence/large-history-after.json、additional-retest.json、entry-paths-after.json、unknown-unit-after.json：针对性复测。
- evidence/final-regression.json：最终九项开发回归。
- evidence/final-independent.json：最终32项独立业务断言及2项浏览器环境尝试。
- evidence/final-original.log、final-browser.log、final-evaluate.log：原有命令重新执行。
- original-probes/probes.cjs、probe-results.json：原始24项探针脚本与最终结果。
- original-probes/model-anomalies.cjs、model-anomalies.json：原始3项模拟模型异常。
- evidence/final-commands.json：命令、工作目录、实际退出码和日志。
- evidence/final-syntax.json：38项语法检查。
- evidence/embedded-module-consistency.json：内嵌模块和源模块一致性。
- evidence/clean-source-consistency.json：交付源码与最终干净验收目录完全一致。
- evidence/clean-install.log、lock-install*.log：依赖安装及缓存路径失败/恢复记录。
- evidence/browser-install.log：Firefox/WebKit下载与运行库条件。
- evidence/independent-first-pass-with-browser-interruption.*：首次Firefox无上限启动被停止的记录；最终结果另存，未隐去。
- evidence/source-changes.patch、code-changes.json、source-hashes-after.json：代码差异与最终哈希。
- evidence/development-sync.json：开发目录同步清单。
- evidence/environment-cases.json：非执行性环境阻塞和范围跳过。
- evidence/artifact-checks.json：打包后解压、启动与文件哈希检查。

- evidence/independent-source-review.json：独立源码写入路径与不变量检查。
- evidence/baseline-integrity.json：原始快照43文件哈希仍然一致。

## 可重复命令

```sh
npm ci
npm test
npm run evaluate
npm run test:browser
npm run test:phase2
npm run test:acceptance
```

CHROMIUM_PATH可指定浏览器位置；默认探测系统Chromium或Playwright安装位置。真实模型测试需要单独授权与密钥，本轮未运行。
