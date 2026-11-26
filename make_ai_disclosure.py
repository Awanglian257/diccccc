"""Generate the separate competition AI-use disclosure for PDF export."""
import argparse
from pathlib import Path

from docx import Document
from docx.shared import Cm, Pt

from make_paper import add_font


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    document = Document()
    document.core_properties.author = ""
    document.core_properties.title = "AI工具使用详情"
    section = document.sections[0]
    section.page_width, section.page_height = Cm(21), Cm(29.7)
    for side in ("top", "bottom", "left", "right"):
        setattr(section, side + "_margin", Cm(2.54))
    for name, font, size in (
        ("Normal", "Noto Serif CJK SC", 12),
        ("Title", "Noto Sans CJK SC", 16),
        ("Heading 1", "Noto Sans CJK SC", 14),
    ):
        style = document.styles[name]
        add_font(style, font, size)
        style.paragraph_format.line_spacing = 1
        style.paragraph_format.space_after = Pt(3)
        style.paragraph_format.space_before = Pt(8 if name == "Heading 1" else 0)

    title_properties = document.styles["Title"].element.pPr
    for item in title_properties.xpath("./w:pBdr"):
        title_properties.remove(item)
    document.add_paragraph("AI工具使用详情", "Title")
    document.add_paragraph("2026 第八届新生数学建模竞赛 A 题")
    sections = [
        ("一、工具名称和型号", [
            "使用 OpenAI Codex，GPT‑6 系列。会话未显示可核实的具体部署版本或构建号。Python、独立验证器、官方评分器及 LibreOffice 属于本项目的运行或验证工具。",
        ]),
        ("二、使用目的与环节", [
            "解读官方题目与文件格式，提出网格图、树约束和 TSV 分配模型，编写并调试 Python 求解器、验证器与实验脚本，运行公开算例、压力测试及官评，整理指标和图表。AI 还参与论文初稿、推导说明、语言修订、模板排版与此说明的编制。",
        ]),
        ("三、提示方式与使用过程", [
            "最初的提示要求先读完官方材料，以题目规定为准，分阶段建立程序、独立检查并运行对照实验。随后要求采用指定 Word 模板，使具备基础数学知识的读者能够理解，再按反馈调整首页、字号、标题和公式顺序。",
            "两项代表性提示分别要求“不要凭经验自行修改题目约束，不要自行假设评分公式”和“一个公式写完就给解释”。前者用于以官方格式和数据实现验证器，后者用于重新组织论文第三章。",
        ]),
        ("四、采纳、人工修改与核验", [
            "采纳了树割约束、拥塞加权的 A*、槽位容量匹配和拆线重布，以及相应代码、实测图表和论文解释。参赛者提供赛题、模板和排版意见，要求解释模型的理论基础并单列 AI 说明。现有会话没有记录队员直接修改模型或代码、独立复跑实验的经过，因此不将这些工作记为人工完成。",
            "AI 在可执行环境中运行了五项单元测试，用独立验证器重算 48 组公开路线的指标，并用原版 grader.exe 对全部八例运行评分和校验报告。公开综合方案与官方路线文件一致。官评指标来自 official/report.json，本地对照来自 experiments/metrics.json，用时与内存引用原始记录。论文中的三引脚和槽位迁移小例仅用于解释方法。",
        ]),
    ]
    for title, paragraphs in sections:
        document.add_heading(title, 1)
        for text in paragraphs:
            document.add_paragraph(text)
    args.output.mkdir(parents=True, exist_ok=True)
    document.save(args.output / "AI工具使用详情.docx")


if __name__ == "__main__":
    main()
