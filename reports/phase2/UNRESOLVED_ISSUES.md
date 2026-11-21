# 未解决与未完成事项

B01～B09：全部 VERIFIED。补测新增 N01～N03：全部 VERIFIED。最终本地功能复测无 OPEN 缺陷；这不代表所有环境和所有潜在问题已获验证。

## BLOCKED

- **ENV-Firefox**：browserType.launch: Timeout 15000ms exceeded.
Call log:
[2m  - <launching> /workspace/reports/phase2/browsers/firefox-1538/firefox/firefox -no-remote -headless -profile /tmp/playwright_firefoxdev_profile-CHSltc -juggler-pipe -silent[22m
[2m  - <launched> pid=11284[22m
[2m  - [pid=11284][err] *** You are running in headless mode.[22m
[2m  - [pid=11284][err] Fontconfig error: No writable cache directories[22m
[2m  - [pid=11284][err] [11315] Sandbox: writing /proc/self/uid_map: EROFS[22m
[2m  - [pid=11284][out] Crash Annotation GraphicsCriticalError: |[0][GFX1-]: RenderCompositorSWGL failed mapping default framebuffer, no dt (t=0.316668) [GFX1-]: RenderCompositorSWGL failed mapping default framebuffer, no dt[22m

- **ENV-WebKit**：browserType.launch: 
╔══════════════════════════════════════════════════════╗
║ Host system is missing dependencies to run browsers. ║
║ Missing libraries:                                   ║
║     libgtk-4.so.1                                    ║
║     libgraphene-1.0.so.0                             ║
║     libharfbuzz-icu.so.0                             ║
║     libmanette-0.2.so.0                              ║
║     libhyphen.so.0                                   ║
║     libGLESv2.so.2                                   ║
╚══════════════════════════════════════════════════════╝
- **ENV-REAL_API**：本轮没有真实 API Key 与真实付费请求的明确授权；未调用 DeepSeek
- **ENV-WINDOWS**：当前为 Linux，无 Windows 实机
- **ENV-MACOS**：当前为 Linux，无 macOS 实机
- **ENV-NODE20**：当前仅 Node 24.22.1，未安装 Node 20.19 下限运行时
- **ENV-REAL_MIC_DEVICE**：无真实麦克风及实体手机，未检验真实识别服务
- **ENV-PHYSICAL_PRINT**：没有真实打印/PDF 阅读器版式验收环境；报告内容生成有回归测试

## SKIP

- **SCOPE-ONLINE_DEPLOYMENT**：本轮修复和验收针对本地程序，未发布或验收线上站点
- **SCOPE-FULL_PENTEST_STRESS**：有历史数据及并发点击测试，不等于完整渗透测试或生产压力测试
- **SCOPE-MULTI_INSTANCE**：当前服务为单进程内存会话设计，未配置多实例持久化恢复

## 仍需保留的设计边界

- 个人数据为浏览器 localStorage，服务端任务/会话为内存；无跨设备同步和多实例持久化保证。进程重启的正确行为是旧会话过期，并非恢复未完成任务。
- 刷新不自动恢复/确认任务；云端已经开始的任务可能继续执行，本轮没有真实 API 计费中断验证。
- QuotaExceededError 使用可重复的 Storage API 故障注入；未通过实际填满磁盘或所有浏览器真实存储额度验证。
- 单表单20次同次点击与同任务确认保护不等于互联网多用户高并发压力测试。
- 食物份量引用既有明确参考值并标记估算，没有新增无来源的勺换算；精确克重仍应称重。
- 代码和下载包已更新，线上网站未更新。公开后端前仍需认证、配额与部署安全专项验收。

没有阻塞项被计为 PASS，也没有运行真实 DeepSeek API。
