# 新生杯 A 题布线求解与复现

项目包含二维网格布线与双芯粒 TSV 协同优化。最终求解器是 `main.py`，使用 Python 3.10 或更高版本，运行评分器时只需标准库。

## Windows 运行官方评分器

1. 解压整个项目，把这些文件留在同一目录。
2. 安装 Python 3.12，安装时勾选 Add Python to PATH。用命令 `python --version` 检查。
3. 双击 `run_official.bat`，或在该目录的 PowerShell 执行命令。

```powershell
.\grader.exe run --solver .\main.py --problem all --no-open
```

评分器会在 `评分结果` 生成新的带时间戳目录。校验新报告时，把下面的目录名换成程序实际打印的名称。

```powershell
.\grader.exe verify ".\评分结果\实际目录名\report.json"
```

也可直接运行单个公开输入并用独立程序核对合法性。

```powershell
python main.py cases/Q1_P1.json my_result.json
python evaluator.py cases/Q1_P1.json my_result.json
```

若评分器找不到 Python，可用 `--python "C:\实际路径\python.exe"` 指定解释器。含空格的路径用双引号包住。正式重跑使用全部案例，提交目录须保留评分器输出的原始文件。

## 一键复现实验

消融实验、图表与人工构造的压力测试建议使用 Python 3.12。安装依赖后，Windows 双击 `run_experiments.bat`，Linux 或 macOS 执行 `bash run_experiments.sh`。

```text
python -m pip install -r requirements.txt
```

两个脚本均创建新目录，让已有结果可供比较。也可分别调用 `python -m unittest -v`、`python experiments.py --out my_experiments` 与 `python stress.py --out my_stress`。单个算法可用 `--variant A/B/C/D/E/cold`，斜线表示选项列表，调用时只填一个值。默认 E。可选 `--rounds`、`--penalty` 和 `--thermal` 用于敏感性分析。

A 使用等权逐引脚接树。B 加拥塞代价。C 再按网络跨度排序。D 加入三轮拆线重布。E 采用七轮、交替起点、三端点中位候选以及 Q2 的换槽和热项。cold 在 Q2 使用相同类型的重布和几何换槽，候选评价关闭热项，最终仍按官方权重统计。

## 文件与计量

| 文件或目录 | 内容 |
|---|---|
| `main.py` | 评分器的双路径入口 |
| `data_loader.py` | UTF-8 JSON、网格邻接、连通分量 |
| `routing.py` | 带权 A* 和逐引脚建树 |
| `tsv_optimizer.py` | 候选过滤、排序及容量增广分配 |
| `optimizer.py` | 网络排序、拥塞代价、拆线重布和换槽 |
| `evaluator.py` | 独立合法性检查和评分公式 |
| `cases/`，`grader.exe` | 附件中的原始公开输入和 Windows 评分器 |
| `official/` | 使用 grader.exe 2.0.0 生成并通过 verify 的完整八例评分和公开解 |
| `experiments/` | 本地 48 组结果、指标 CSV/JSON、图表和流程图 |
| `stress-results/` | 80×73×2 合成数据、路线和实测指标 |
| `test_project.py`，`test-results.txt` | 单元测试和实际输出 |
| `技术分析报告.md`，`项目阶段记录.md` | 官方约束、模型、开发与验证记录 |
| `make_paper.py` | 从实测结果生成可编辑的论文和绘制流程图 |

官报由 Windows Python 3.12.10 和原版评分器在 Wine 10.0 下生成，Windows 原生环境速度和内存计量可能不同。公开官方与 Linux 本地 E 组的路线文件逐字节一致。本地实验以启动到退出测墙钟时间、以 5 ms 间隔采样求解进程的峰值 RSS。评分器的峰值提交内存采用其自身口径，两个内存值分开使用。

正式算法固定遍历规则，无随机性。重布到达时间保护线会保留当时的最好完整解，特别慢的环境或更大案例可能产生不同路线。自建压力实验用固定种子 202611；自建 Lref 为运行测试用占位值，统计中排除其综合分。

如需重新生成论文，在本目录运行以下命令，其中模板为原始上传的格式规范 DOCX。

```text
python make_paper.py "格式规范.docx" paper
```

## 提交前由队员处理的事项

- 核对主办方对 AI 辅助的规定和承诺书措辞。本项目使用了 AI 辅助开发、实验整理及论文撰写。附档承诺书要求依靠队伍内部完成相关工作，已读材料未明确 AI 辅助适用范围。
- 论文正文按匿名要求排版。三名队员需本人填写并手签，扫描或拍照，将签字版承诺页替换到论文末页。DOCX 中指定黑体和宋体。交付 PDF 在 Linux 用 Noto CJK 对应的黑体和宋体字体导出；Windows Word 可使用模板指定字体导出签字版。
- DOCX 题目文件规定，正式 PDF 名和邮件标题使用 `A202611{队号}_{队长}_{队员1}_{队员2}`。发送至 `308927692@qq.com`，PDF 用附件上传。另提交可运行源程序、依赖说明和完整官方评分目录。论文和命令中的姓名与签名须由队员核对。
