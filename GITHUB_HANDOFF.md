# GitHub 本地交付说明

目标仓库：https://github.com/Awanglian257/diccccc.git

接入时远程仓库为空；当前分支为 fix/phase2-quality。本目录导入已验收的2.1.1完整程序、后端、补丁、报告与测试证据。原始工作目录未被覆盖。

- 启动：npm start（运行依赖为Node内置模块）。
- 安装测试依赖：npm ci。
- 测试：npm test、npm run test:browser、npm run test:phase2、npm run test:acceptance、npm run evaluate。浏览器需系统Chromium或通过CHROMIUM_PATH指定。
- 报告：reports/phase2/PHASE2_FINAL_REPORT.md。
- 补丁：source-changes.patch，适用于原2.1.0代码；当前目录已经包含修复，请勿重复应用。

报告中的/workspace路径指历史审查环境；JSON与日志保留原始记录，并非新的远程验收结论。历史目录/快照与已下载浏览器、缓存、node_modules未导入仓库，原工作区仍保留。

本次只准备本地分支和提交，没有推送、发布或修改GitHub权限。真实模型测试仍需要密钥和单独授权。
