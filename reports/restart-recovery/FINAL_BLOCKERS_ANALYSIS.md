# 健康管家2.1.1 最终环境阻塞分析

日期：2026-11-21（上海时间）。没有调用真实API、发布或推送。原2项阻塞现为：**WebKit原冒烟用例PASS；Firefox仍BLOCKED**，没有强制改写测试结果。

## 原始证据与测试要求

原始`reports/confirm-retry/independent.json`与对应日志、`tests/phase2-independent.cjs`已读取。两项名称为ENV-Firefox、ENV-WebKit。原原因都是Playwright1.62.1所需浏览器二进制不存在：firefox-1538/firefox/firefox及webkit-2336/pw_run.sh。原断言只是启动浏览器、打开本机页面并找到`#baselineEditor`，不是完整跨浏览器功能回归。

## 处理结果与分类

| 项目 | 实施与真实结果 | 分类 |
|---|---|---|
| ENV-WebKit | 下载WebKit2336到/workspace/browser-runtime；解压Debian13签名源中的缺失库到/workspace/browser-libs。实际启动原测试、打开页面并通过原首页断言 | 原环境依赖缺失已修复；仅冒烟PASS |
| ENV-Firefox | 已下载Firefox1538。启动仍超时，日志包含/proc/self/uid_map只读、RenderCompositorSWGL framebuffer映射失败；浏览器未完成自动化连接，未执行页面断言 | 保留BLOCKED：受限宿主/浏览器启动环境，未证实为健康管家源码缺陷 |

WebKit曾出现两种额外启动障碍：预检只查系统动态库缓存，无法识别工作区私有库；打包MiniBrowser包装器覆盖LD_LIBRARY_PATH。通过在工作区的浏览器依赖目录链接已解压库解决包装器问题。设置PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1仅绕过无法识别私有库的宿主预检，**没有跳过浏览器启动、页面加载或测试断言**。实际通过证据为`webkit-final.json`及最终全套独立验收JSON。

Firefox已尝试可写缓存、软件渲染及测试子进程沙箱环境选项，仍启动超时，未将其标为PASS。日志只能证明这些启动异常共存，不能据此断言唯一底层根因。没有修改系统目录或测试浏览器断言，也没有把Chromium结果代替Firefox。

## 可复现环境

工作区缓存：`PLAYWRIGHT_BROWSERS_PATH=/workspace/browser-runtime`；私有库：`/workspace/browser-libs/root/usr/lib/x86_64-linux-gnu`；可写缓存：`XDG_CACHE_HOME=/workspace/browser-runtime/cache`。下载/安装日志和各轮启动结果保留于`reports/restart-recovery/`。私有库来自正常APT签名仓库，使用自建工作区APT状态目录，没有修改系统包管理状态。

最终全套独立验收使用这些环境变量及前述仅预检开关。测试源码的浏览器循环及首页断言保持不变。原有S16另有两项与后端新契约相关的修正：旧“重启必须401”断言改为原会话恢复后未知任务404，并新增外来令牌401；重启子进程使用独立临时状态文件，避免与父服务发生预期的单写入者锁冲突。保留了修改前503失败日志及原测试文件，未删除用例或放宽为任意响应均通过。

## Firefox人工验收步骤（当前未执行）

1. 使用受支持的普通Debian/Ubuntu测试机或具备正常用户命名空间与图形/共享内存能力的虚拟机；不要沿用本受限宿主的只读/proc限制。
2. 安装项目锁定依赖：`npm ci`；安装匹配版本浏览器及系统依赖：`npx playwright install --with-deps firefox`。此命令应由该测试机有权限的维护者执行。
3. 不配置真实模型Key，启动`npm start`。先执行`ONLY=ENV-Firefox node tests/phase2-independent.cjs`，确认真实启动并通过首页断言，保存JSON和日志。失败则仍为BLOCKED/FAIL，不勾选通过。
4. 在Firefox独立测试档案中打开本机URL，建立测试身体基准；录入一餐，修改、删除后核对统计；新增两条体重并查看趋势。保存截图和具体输入/输出。
5. 在线AI关闭，选择手头食物生成本地计划；确认一次、刷新核对不重复。若需远程确认恢复，通过项目本地后端的授权任务接口生成use_model=false任务，按重启报告的用例操作。
6. 使用同一个持久状态路径停止并重启后端，查询原提交标识；验证已完成、待确认及中断状态区分。将实际结果交给维护者重新审查，不能凭人工步骤存在就关闭BLOCKED。

WebKit目前只通过原冒烟，若发布宣称其完整功能兼容，也需要按第4～6步补齐实际功能验收。

## 冻结结论

**暂不建议无条件冻结2.1.1为全浏览器最终版本**：Firefox仍有真实环境阻塞，人工验收尚未完成。后端恢复问题已专项实现并验证。若交付明确限定Chromium、单后端进程和持久本地磁盘，可进行有条件冻结评审；本轮未发布或创建版本标签。
