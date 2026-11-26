"""Build the anonymous editable paper from official and local experiment results."""
import argparse
import json
from pathlib import Path
import re
from docx import Document
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt


def add_font(style, chinese, points):
    style.font.name = "Times New Roman"
    style.font.size = Pt(points)
    properties = style.element.get_or_add_rPr()
    fonts = properties.rFonts
    for theme in ("asciiTheme","hAnsiTheme","eastAsiaTheme","cstheme"):
        fonts.attrib.pop(qn("w:"+theme),None)
    fonts.set(qn("w:eastAsia"),chinese)
    lang = properties.find(qn("w:lang"))
    if lang is None:
        lang = OxmlElement("w:lang")
        properties.append(lang)
    lang.set(qn("w:eastAsia"),"zh-CN")


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def draw_flow(destination):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import FancyBboxPatch
    fig,ax = plt.subplots(figsize=(8,4))
    ax.set(xlim=(0,8),ylim=(0,4.8))
    ax.axis("off")
    boxes = [
        (4,4.35,"Read JSON; build positive-capacity planar graph"),
        (2.15,3.40,"One tier: initialize net order"),
        (5.85,3.40,"Two tiers: filter and match TSVs"),
        (4,2.45,"Attach pins by A*; update shared edge usage"),
        (4,1.50,"Rip up a net, try routes or TSV moves, retain best"),
        (4,.55,"Write edge IDs; independent tree and score checks"),
    ]
    for x,y,label in boxes:
        width = 3.48 if y==3.4 else 5.35
        ax.add_patch(FancyBboxPatch((x-width/2,y-.245),width,.49,boxstyle="round,pad=.07",
                                    facecolor="#edf4f7",edgecolor="#29465a"))
        ax.text(x,y,label,ha="center",va="center",fontsize=10)
    for a,b in ((0,1),(0,2),(1,3),(2,3),(3,4),(4,5)):
        x,y,_=boxes[a]
        u,v,_=boxes[b]
        ax.annotate("",xy=(u,v+.31),xytext=(x,y-.31),
                    arrowprops={"arrowstyle":"->","color":"#29465a","lw":1.2})
    fig.savefig(destination,dpi=180,bbox_inches="tight")
    plt.close(fig)


def make(template, destination, pdf_fonts=False):
    experiments = Path("experiments")
    rows = load(experiments/"metrics.json")
    official = load(Path("official/report.json"))
    stress = load(Path("stress-results/metrics.json"))
    official_rows = next(v for v in official.values() if isinstance(v,list) and v and "case_id" in v[0])
    official_summary = next(v for v in official.values() if isinstance(v,list) and v and "final" in v[0])
    original = Document(template)
    commitment = [p.text for p in original.paragraphs[71:93]]
    document = Document()
    document.core_properties.author = ""
    document.core_properties.last_modified_by = ""
    document.core_properties.title = "三维集成电路的多目标全局布线优化"
    document.core_properties.subject = "2026第八届新生数学建模竞赛A题"

    for section in document.sections:
        section.page_width,section.page_height = Cm(21),Cm(29.7)
        section.top_margin = section.bottom_margin = Cm(2.54)
        section.left_margin = section.right_margin = Cm(3.17)
        section.different_first_page_header_footer = False
        for header in (section.header,section.first_page_header,section.even_page_header):
            for p in header.paragraphs:
                p.clear()
        section.footer_distance = Cm(1.25)
        footer = section.footer.paragraphs[0]
        footer.clear()
        footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
        field = OxmlElement("w:fldSimple")
        field.set(qn("w:instr"),"PAGE")
        footer._p.append(field)
        sect = section._sectPr
        numbering = sect.find(qn("w:pgNumType"))
        if numbering is None:
            numbering = OxmlElement("w:pgNumType")
            sect.append(numbering)
        numbering.set(qn("w:start"),"1")
    styles = document.styles
    body_font = "Noto Serif CJK SC" if pdf_fonts else "宋体"
    heading_font = "Noto Sans CJK SC" if pdf_fonts else "黑体"
    for name,font,size in (("Normal",body_font,12),("Title",heading_font,16),("Heading 1",heading_font,14),
                           ("Heading 2",heading_font,12),("Heading 3",heading_font,12)):
        st = styles[name] if name in styles else styles.add_style(name,WD_STYLE_TYPE.PARAGRAPH)
        add_font(st,font,size)
        st.font.bold = name.startswith("Heading") or name=="Title"
        st.font.color.rgb = None
        st.paragraph_format.keep_with_next = name.startswith("Heading")
        st.paragraph_format.line_spacing = 1
        st.paragraph_format.space_after = Pt(0)
        st.paragraph_format.space_before = Pt(6 if name.startswith("Heading") else 0)
        st.paragraph_format.alignment = (WD_ALIGN_PARAGRAPH.CENTER if name in {"Heading 1","Title"}
                                         else WD_ALIGN_PARAGRAPH.LEFT)
    normal = styles["Normal"].paragraph_format
    normal.first_line_indent = Pt(0)
    normal.widow_control = True
    normal.keep_with_next = False
    for grid in document.element.body.xpath(".//w:docGrid"):
        grid.getparent().remove(grid)
    for name in ("论文正文","论文图表"):
        st = styles.add_style(name,WD_STYLE_TYPE.PARAGRAPH)
        st.base_style = styles["Normal"]
        add_font(st,body_font,12)
        st.paragraph_format.line_spacing = 1
        st.paragraph_format.first_line_indent = Pt(24 if name=="论文正文" else 0)
        st.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.LEFT if name=="论文正文" else WD_ALIGN_PARAGRAPH.CENTER

    def para(content):
        return document.add_paragraph(content,"论文正文")

    def center(content):
        return document.add_paragraph(content,"论文图表")

    def head(content, level=1):
        return document.add_heading(content,level)

    def page():
        document.add_page_break()

    def formula(content):
        def math_run(value):
            r = OxmlElement("m:r")
            t = OxmlElement("m:t")
            t.set(qn("xml:space"),"preserve")
            t.text = value
            r.append(t)
            return r

        p = center("")
        o = OxmlElement("m:oMath")
        start = 0
        for match in re.finditer(r"(.)_\{([^{}]+)\}",content):
            if start < match.start():
                o.append(math_run(content[start:match.start()]))
            subscript = OxmlElement("m:sSub")
            base = OxmlElement("m:e")
            base.append(math_run(match[1]))
            sub = OxmlElement("m:sub")
            sub.append(math_run(match[2]))
            subscript.extend((base,sub))
            o.append(subscript)
            start = match.end()
        if start < len(content):
            o.append(math_run(content[start:]))
        p._p.append(o)

    def table(title, headers, values):
        caption = center(title)
        caption.paragraph_format.keep_with_next = True
        t = document.add_table(rows=1,cols=len(headers))
        t.autofit = False
        for col in t.columns:
            col.width = Cm(14.66/len(headers))
        for row,values_row in zip([t.rows[0],*(t.add_row() for _ in values)],[headers,*values]):
            for cell,value in zip(row.cells,values_row):
                cell.width = Cm(14.66/len(headers))
                p = cell.paragraphs[0]
                p.style = styles["论文图表"]
                p.add_run(str(value))
            props = row._tr.get_or_add_trPr()
            props.append(OxmlElement("w:cantSplit"))
        t.rows[0]._tr.get_or_add_trPr().append(OxmlElement("w:tblHeader"))
        for row in list(t.rows)[:-1]:
            for cell in row.cells:
                cell.paragraphs[0].paragraph_format.keep_with_next = True
        borders = OxmlElement("w:tblBorders")
        for edge in ("top","bottom"):
            b = OxmlElement("w:"+edge)
            b.set(qn("w:val"),"single")
            b.set(qn("w:sz"),"8")
            borders.append(b)
        t._tbl.tblPr.append(borders)
        for cell in t.rows[0].cells:
            border = OxmlElement("w:tcBorders")
            edge = OxmlElement("w:bottom")
            edge.set(qn("w:val"),"single")
            edge.set(qn("w:sz"),"4")
            border.append(edge)
            cell._tc.get_or_add_tcPr().append(border)

    def image(path, caption, width=14):
        p = center("")
        p.add_run().add_picture(str(path),width=Cm(width))
        p.paragraph_format.keep_with_next = True
        center(caption)

    public = [r for r in official_rows if r["visibility"]=="public"]
    center("杭州电子科技大学")
    center("2026第八届新生数学建模竞赛")
    document.add_paragraph("三维集成电路的多目标全局布线优化","Title")
    center("摘　要")
    para('芯片设计需要把分散的引脚接起来，但几条线如果选择同一条通道，就可能超过它能容纳的数量。本文把芯粒划成网格，用一棵树连接每组必须互通的引脚。在单层网格上同时控制线长和拥塞；在双层网格上，还需为每个跨层网络安排一个硅通孔（TSV），使它们的空间分布与给定热需求相匹配。')
    para('本文先给拥挤通道加价，用 A* 搜索逐个接入引脚，再撤下一部分既有线路重新寻找路径。双层问题先按槽位容量安排硅通孔，再比较换孔位置及其两侧线路的整体得分。')
    a,b,c,d = public
    para(f"官方评分器的四个公开算例均通过合法性检查，平面总溢出均为零。二维两例线长为 {a['result']['wirelength']} 和 {b['result']['wirelength']}，得分 {a['score']:.2f} 和 {b['score']:.2f}。三维两例线长为 {c['result']['wirelength']} 和 {d['result']['wirelength']}，热匹配分 {c['result']['H']:.2f} 和 {d['result']['H']:.2f}，得分 {c['score']:.2f} 和 {d['score']:.2f}。全部四个隐藏算例合法，其中一个二维算例仍有 3 单位溢出。两问机器分分别为 {official_summary[0]['final']:.2f} 和 {official_summary[1]['final']:.2f}。对照实验显示，拥塞代价降低了溢出，过大的热权重则会因线长增加而降低综合分。")
    para("关键词　全局布线，斯坦纳树，拆线重布，硅通孔，热匹配")
    page()

    head("一、问题重述与分析")
    para('把芯粒看成一张方格地图。每个网格单元（GCell）对应一个顶点，相邻单元之间的边对应一束可用通道。输入给出的每个网络是一组必须相互连通的引脚，同一个网络可以在中间顶点分叉，多条支路共用的那段边只计一次。当不同网络经过同一条边时，每个网络各占一份容量。因此，即使每个网络都找到了自己最短的路径，合在一起仍可能严重拥堵。')
    head("1.1 二维问题",2)
    para('二维问题是在一张地图上为每个网络选出一棵树。容量为零的边相当于道路封闭。正容量边允许超额使用，但每超出一份都会影响得分。例如，两条网络经过容量为 1 的边，需求为 2，溢出为 1。分配好的网络越多，后续网络在短路径和空闲通道之间的取舍就越重要。')
    head("1.2 双芯粒问题",2)
    para('双芯粒可看作上下叠放的两张地图。同一平面坐标在两层上代表两个顶点，只有候选位置的硅通孔才能把它们连起来。每个跨层网络恰好使用一个 TSV。选定槽位后，可以在两层分别把引脚接到这个槽位，再用 TSV 把两棵树连起来。槽位太偏远会增加平面线长，槽位太集中又可能占满通道，还会改变热需求匹配。因此分配槽位时要先满足硬容量，再比较实际布线效果。')
    head("二、模型假设与符号说明")
    para('布局、引脚和热需求均取自原始输入。每走一条平面边按 1 计长，每通过一个 TSV 按 6 计长，单位由赛题统一规定。多个引脚重合时，接到那个顶点即可。热图给定的是空间需求权重，评价时把同一热格内的 TSV 数与需求值逐格比较。计时从求解程序启动到退出。')
    table("表1　集合、参数及变量",("符号","定义"),[
        ("N，Pₙ","网络集，网络 n 的去重引脚集"),
        ("V，Eₚ，Eₜ","节点集，输入平面边集，输入 TSV 边集"),
        ("cₑ，ℓₑ","边容量，单位长度代价"),
        ("xₙₑ，yₙᵥ","是否使用边 e，是否包含节点 v"),
        ("Dₑ，Oₑ","边需求，平面边溢出"),
        ("hᵦ，tᵦ","热格 b 的需求，分配的 TSV 数"),
        ("Lᵣₑ𝒻，τ","输入参考线长，单算例时间上限"),
    ])
    head("三、数学模型")
    head("3.1 连通性及树结构",2)
    para("对每个网络选择任一引脚作为根 rₙ。令 xₙₑ、yₙᵥ 取 0 或 1，对每个引脚顶点 v 固定 yₙᵥ=1。边 e 的两个端点分别为 u 和 v，要求 xₙₑ≤yₙᵤ 且 xₙₑ≤yₙᵥ。对于任意不含根的节点子集 U 和其中任一节点 v，令 δ(U) 为一端在 U 内、一端在 U 外的边集，施加割约束及树边数约束。")
    formula("∑_{e∈δ(U)} xₙₑ ≥ yₙᵥ，　∑_{e∈E} xₙₑ = ∑_{v∈V} yₙᵥ − 1。")
    para('这些约束分别管两件事。首先，任何脱离根的已选顶点集合都必须有一条选中边通向集合外。若有一块和根完全分离，取那块为 U 就会违反该约束。其次，连通网络中若还有环，删去环上一条边仍能连通，因此它的边数必然多于树所需的顶点数减一。由此，两组约束共同得到树。容量为零的输入边固定 xₙₑ=0，只能从输入列出的边中选择。若所有引脚重合，单顶点与空边集就构成一棵树。')
    head("3.2 容量及 TSV 约束",2)
    para("平面边需求 Dₑ=∑ₙxₙₑ，正容量平面边溢出为 Oₑ=max(0,Dₑ−cₑ)。跨层网的 TSV 边选择和等于 1，单层网等于 0，且单层网在另一层的节点变量固定为 0。对每一候选 TSV 边，要求 Dₑ≤cₑ。槽位以输入为准，题设规定有引脚的 GCell 不设槽位。两层即使投影坐标相同，节点也彼此独立。")
    head("3.3 官方目标函数",2)
    para('评分把三种布线质量转成百分制。W 按总线长 L 超过参考线长的比例扣分。C 按正容量平面边的溢出量扣分，其中同样多的溢出发生在小容量边时影响更大。H 把 TSV 数与热需求的 Pearson 相关系数 ρ 换成分值。ρ 为正表示需求较高的格子通常也放了较多 TSV。任一向量在各格中都相同时，赛题取 ρ=0。每个 TSV 按平面坐标归入一个热格，两个方向的分格数分别是 Bₓ 和 Bᵧ。')
    formula("L = ∑ₙ∑ₑ ℓₑxₙₑ，　W = 100 exp[−4 max(0,L/Lᵣₑ𝒻−1)]。")
    formula("C = 100 / √[1+10∑_{e∈Eₚ, cₑ>0}(Oₑ/cₑ)²]，　H = 50(1+ρ)。")
    formula("b = ⌊Bᵧy/nᵧ⌋Bₓ + ⌊Bₓx/nₓ⌋，　tᵦ = ∑_{e∈Eₜ,bin(e)=b} Dₑ。")
    formula("ρ = ∑ᵦ(hᵦ−h̄)(tᵦ−t̄) / √[∑ᵦ(hᵦ−h̄)² · ∑ᵦ(tᵦ−t̄)²]。")
    para("时间分 T=clip(100·log₁₀(τ/t)/log₁₀(τ/10),0,100)，10 秒内满分。单算例合法且符合资源上限时，二维最大化 0.55W＋0.35C＋0.10T，三维最大化 0.45W＋0.25C＋0.20H＋0.10T。非法或资源越界计 0 分。每问公开与隐藏平均分的权重为 0.4 与 0.6。")
    para("读取题方提供的参考线长。该量忽略容量、障碍与槽位竞争，且超过 12 个端点时可能用近似。题面未指定参考线长为零时的公式取值。程序与本地验证按参考线长趋近零的右极限处理，四个公开算例的参考线长都为正。")

    head("四、算法设计与独立验证")
    head("4.1 加权最短路与多端点树",2)
    para("令 uₑ 为已占用通道数，rₑ=uₑ/cₑ。在方案 B 至 E 中，将边权设为下式。γ 默认 18。hₑ 初始为零，每轮在溢出边上加 0.4γ。即将达到容量时，使用下一条网络的代价增大；历史项让反复拥堵的边更难入选。方案 A 的边权恒为 1。")
    formula("wₑ = 1+0.4rₑ²+γ max[0,rₑ−(cₑ−1)/cₑ]+hₑ。")
    para('程序先取一个引脚作起点，从离当前树最近的未接引脚出发寻找接入路径。这里的距离为横向坐标差与纵向坐标差绝对值之和，即曼哈顿距离。A* 按已走代价与剩余代价下界之和选择下一步。剩余下界取到包住当前树的最小矩形的距离：接到树必先到达该矩形，而每步的代价至少为 1。相邻顶点到矩形的距离最多相差 1，因此启发式一致[1]。')
    para("找到新路径与树的第一个接触点时停止搜索。新路径只在这个点接入，因此不会形成环。举例说，三个引脚位于 (0,0)、(2,0)、(1,1)，在无障碍等权网格上，选择坐标中位点 (1,0) 作分叉点，三段共 3 条边。程序在处理三个端点时也试算这个中位点，并用实际边权比较。更多端点时，精确求解斯坦纳树的复杂度随端点数迅速增加[2]，逐次接入便于把时间控制在评分要求内。")
    head("4.2 容量匹配和热匹配",2)
    para('初始分配先排除无法接通的槽位。每层仅使用正容量边，把任意两点之间可以互达的区域称为连通分量。槽位的两端必须分别落在两层引脚所在的分量中。通过这项筛选后，用槽位到两层引脚包围盒的距离和排序，再用到两层最近引脚的距离打破并列。')
    para("如果最合适的槽位已满，直接跳过可能让后面的网络无处可选。设网络甲只能用槽位一，网络乙已占槽位一但也能用槽位二，且槽位二有空位。把乙迁到槽位二便能为甲腾出空间。程序通过增广路径在多个网络和槽位之间寻找这样的迁移链。")
    para('重布跨层网时，候选包括原槽位、几何排序最靠前的至多三个有余量槽位，以及启用热项时按几何与热收益混合排序的至多三个槽位。混合排序用包围盒距离加 0.05 倍最近引脚距离，再减去 2.5λ·max(Lref,1)·H/200。这个估计只用于缩小搜索范围。为每个候选算出两侧平面树后，用实际全局质量 0.45W＋0.25C＋0.20λH 作选择。λ=0 时只看线长和拥塞，报告实验结果仍使用官方权重。')
    head("4.3 拆线重布及校验",2)
    para('较长的网络通常需要跨过更多区域，故方案 C、D、E 先按各层引脚包围盒跨度之和排序，以引脚数打破并列，均从大到小。基线 A 和只加拥塞权重的 B 沿用输入顺序。D 至多重布三轮，E 默认至多七轮，并在重布时优先处理沿途溢出量较大的网络。')
    para("每次先撤掉一个网络的旧路径，把它占用的容量归还，再在其他网络仍在原位的条件下试算新路径。拥塞较重时，允许个别轮次暂时绕开满载边以腾出通道。每轮结束保留目前质量最高的完整解，达到轮数、停止条件或用时保护线后输出。反复拥塞的边在后续轮次中获得历史加价，这一思路与协商式布线有关[3]。")
    para('验证程序与求解器分别工作。它从 JSON 重新读入每个网络的边，先检查未知边、重复边和禁行边，再从一个引脚沿这些边逐层访问顶点。访问结果必须覆盖所有引脚和所选边的端点，且满足树边数条件。最后重新统计两层通道和 TSV 槽位占用，依照题目公式算分。公开结果还与原版评分器的输出相互核对。')
    destination.mkdir(parents=True,exist_ok=True)
    draw_flow(experiments/"flow.png")
    image(experiments/"flow.png","图1　容量匹配、成树、重布与验证流程",13)
    head("五、实验设计与结果")
    para('实验从简单方案逐项加入改动。A 用等权路径，B 补上拥塞权重，C 再调整处理顺序，D 加入重布，E 同时使用交替起点、三端点中位候选和双层换槽。双层另设不使用热项的 cold 组，以观察相同任务加入热目标后的变化。二维公开算例有 230 和 520 个网络，双层有 300 和 600 个网络。评分器 2.0.0 在 Linux 的 Wine 10.0 兼容层中调用 Windows Python 3.12.10。表2的时间与内存来自原版评分器，其他实验的内存是本地每 5 毫秒采样所得的进程常驻内存峰值。')
    table("表2　官方评分器运行结果",("算例","L","总/最大溢出","H","秒","MB","得分"),[
        (r["case_id"],r["result"]["wirelength"],f'{r["result"]["total_overflow"]}/{r["result"]["max_overflow"]}',
         f'{r["result"]["H"]:.2f}' if r["problem"]==2 else "—",
         f'{r["seconds"]:.2f}',f'{r["peak_memory_mb"]:.1f}',f'{r["score"]:.2f}') for r in official_rows
    ])
    para('表2中，两个二维公开例分别比参考线长多 0.82% 和 1.26%，双层公开例分别多 9.34% 和 9.69%。四个公开例均无溢出，两个双层例分别布置了 130 和 295 个 TSV。二维隐藏例 Q1_H2 的三条边各溢出 1 单位，其余七例均无溢出。八例都通过合法性检查和资源限制。Q2_H1 虽无溢出，线长分只有 40.74，热匹配分为 54.66。这说明消除拥塞之后，槽位与路径的选择仍可能明显影响得分。')
    table("表3　各算法公开算例本地综合分",("方案","Q1_P1","Q1_P2","Q2_P1","Q2_P2"),[
        (v,*[next((f'{r["score"]:.2f}' for r in rows if r["experiment"]==v and r["case"]==c),"—")
             for c in ("Q1_P1","Q1_P2","Q2_P1","Q2_P2")]) for v in ("A","B","C","D","E","cold")
    ])
    para("B 把四例总溢出由 63、120、45、108 降为 0、1、0、1。排序单独加入后，Q1_P1 的溢出由 0 变为 1，得分从 92.15 降到 80.18；Q1_P2 则由 84.50 升为 91.95。按跨度优先让较长网络先选择通道，但顺序仍会改变后续网络可用的通道。E 在四例的分数均高于 D，输出的公开路线与官方评分器产生的文件逐字节一致。")
    image(experiments/"comparisons.png","图2　公开算例本地运行时间与算法得分")
    image(experiments/"Q1_P1"/"paths.png","图3　Q1_P1 线长前十二个网络的路径与引脚",11)
    image(experiments/"Q2_P2"/"utilization.png","图4　Q2_P2 两芯粒的 GCell 容量利用率")
    para("图3和图5用不同颜色区分网络，圆点表示引脚。图5的竖向线段表示连接两层的 TSV。图4显示每个网格单元相邻平面边中最大的需求容量比，接近 1 的位置意味着至少一条相邻边已接近满载。")
    image(experiments/"Q2_P2"/"paths.png","图5　Q2_P2 的十二条较长网络与跨层连接",11)
    head("六、敏感性分析")
    para("固定原始输入与官方计分公式，仅改变求解参数。二维的 γ 使用 4、10、18 和 32，两个算例在七轮下均为零溢出，Q1_P1 分数范围为 98.09–98.22，Q1_P2 为 97.30–97.47。固定 γ=18，将迭代次数从 0、1、3 增至 7，两例均有持续改善。进一步迭代会增加耗时，接近 10 秒后需要把增益与时间扣分一并衡量。")
    para("开启热项使 Q2_P1 的 H 从 81.87 升至 90.03，线长增加 15；Q2_P2 的 H 从 74.51 升至 86.40，线长增加 48。二者综合分分别提高约 0.99 和 1.44。令 λ=4 时 H 上升至 97.47 和 94.98，但线长升至 3332 和 7154，最终分下降。λ=0.5 在 Q2_P2 得 82.99，高于默认值的 82.82；λ=1 在 Q2_P1 的表现更好。正式求解保持同一 λ=1。")
    image(experiments/"sensitivity.png","图6　热权重、拥塞惩罚和重布轮次的独立敏感性实验")
    head("七、模型评价与局限")
    para(f"自建 80×73×2 的 800 网络算例，含单引脚和 13 引脚网络、容量为 2 的 TSV、7×5 热图及禁边。固定随机种子 202611，算法在 {stress['seconds']:.2f} 秒通过独立校验，线长 {stress['wirelength']}、总溢出 {stress['total_overflow']}。自建算例的参考值仅用于运行测试，其综合分不纳入正式比较。")
    para('单次 A* 最坏会访问一个芯粒内全部可达的顶点，跨层网络与槽位的数目同时增大时，候选表空间也会随两者乘积增长。本例用稀疏邻接表保存实际可走的边，并把重布限制在少量候选上。求解器只根据输入给出的大小、引脚、边和容量运行，因此矩形网格、不同热图和多容量槽位共用同一个流程。')
    para('网络顺序会影响早期留下的可用通道，逐网调整也可能停在局部最优。例如，两条网络若分别换槽都变差，同时交换槽位却有机会缩短总线。这类组合不在目前的搜索范围。包围盒距离只提供几何估计，存在障碍时可能漏掉实际代价较低的槽位。后续可对拥堵边周围的网络做成组重布，并在少引脚小区域内比较精确子树。热分衡量的是空间相关性，若要估计实际温升，还需材料、功率和边界条件。')

    page()
    head("参考文献")
    para("[1] Hart P E, Nilsson N J, Raphael B, A Formal Basis for the Heuristic Determination of Minimum Cost Paths, IEEE Transactions on Systems Science and Cybernetics, 4(2):100–107, 1968.")
    para("[2] Dreyfus S E, Wagner R A, The Steiner Problem in Graphs, Networks, 1(3):195–207, 1971.")
    para("[3] McMurchie L, Ebeling C, PathFinder: A Negotiation-Based Performance-Driven Router for FPGAs, Proceedings of the 1995 ACM Third International Symposium on Field-Programmable Gate Arrays, Monterey: ACM, 111–117, 1995.")
    page()
    head("附录")
    head("附录1　变量与代码对应",2)
    table("表4　变量和约束的程序表示",("数学对象","程序位置及变量"),[
        ("E、cₑ、Pₙ","data_loader.py  Grid.adj / cap / groups"),
        ("xₙₑ、yₙᵥ","optimizer.py  routes；routing.py  vertices"),
        ("Dₑ、L、溢出平方和","optimizer.py  usage / total / congestion"),
        ("tᵦ、H、λ","optimizer.py  counts / score_for / thermal"),
        ("槽位容量","tsv_optimizer.py  owners / assigned"),
        ("官方指标及合法性","evaluator.py  evaluate"),
    ])
    head("附录2　复现实验",2)
    para("在 Windows 用 Python 运行 main.py，顺序传入算例 JSON 和输出 JSON 两个路径。用官方 grader.exe 的 run 子命令生成完整记录，使用 verify 校验报告。experiments.py 在四个公开输入上生成逐组布线 JSON、实验表和图。README.md 提供命令和目录说明。评分器报告附在论文外，含官方报告及公开路线。")
    head("附录3　AI 使用与数据来源",2)
    para("本项目使用 OpenAI Codex 辅助解读题目、建立模型、编写和调试程序、运行验证、绘制图表以及起草和修订论文。官方得分来自原版评分器生成的 report.json，算法对照来自本地实际运行保存的 metrics.json，文中的坐标和槽位迁移小例用于说明原理。提交前应按赛事关于 AI 辅助的要求核对这份说明。")
    page()
    for i,text in enumerate(commitment):
        if i in (0,1):
            center(text.strip())
        elif text.strip():
            p = document.add_paragraph(text)
            if i >= 15:
                p.paragraph_format.space_after = Pt(9)
            if i == 4:
                center("A  □　　　B  □")
        elif i in (2,7,14,19):
            document.add_paragraph()
    document.save(destination/"论文_承诺页待手签.docx")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("template",type=Path)
    parser.add_argument("output",type=Path)
    parser.add_argument("--pdf-fonts",action="store_true")
    args = parser.parse_args()
    make(args.template,args.output,args.pdf_fonts)
