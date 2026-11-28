# 论文修订交付

最终 PDF：论文_最终提交版_承诺页待手签.pdf，共 26 页。第 18—25 页为附录 5 核心算法源代码，第 26 页为待手签承诺书。

可编辑源文件为 paper.tex，图片在 assets，完整对应 Python 文件在 core。旧目录中的 DOCX/PDF 保留为历史版本，不包含本次完整修订。

## 编译

安装 TeX Live（XeLaTeX、fontspec、amsmath、amssymb、titlesec、listings）及 Noto Serif CJK SC、Noto Sans CJK SC、DejaVu Sans Mono 字体。Linux 执行 `bash build.sh`；Windows 执行 build.bat。

## 核验与限制

21 个编号公式使用真正 LaTeX 数学环境；根式、分式、求和与上下标采用数学命令。编译日志无 Overfull、缺字和未定义引用。已查看全部 26 页排版缩略图。

附录源码通过字节比较、SHA256 以及 AST 函数起止行检查，与仓库实际求解器一致；详见 core-manifest.json 和核验记录/源码检查.json。本次未修改求解算法和既有实验数据。

官方评分结果及重跑差异见官方评分器核验报告.md、本次评分报告。论文保留历史实验值，运行时间变化不混写成算法改善。

字体采用 Noto CJK 替代环境中缺少的宋体/黑体，因此尚不能声称满足学校指定字体的严格一致性。正文 12 pt、表格和图注 10.5 pt；核心代码单独使用等宽字体。承诺页须参赛者填写并手签，人工核查不能由 AI 代签。独立 AI 工具说明位于仓库支撑材料目录。
