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
    para("给定芯粒网格、引脚位置、通道容量与候选硅通孔，本文研究多端点网络的树形全局布线。将每个网格单元建模为顶点，正容量平面边作为候选布线路径。问题一同时考虑总线长与拥塞。问题二把跨芯粒网络分解为两棵平面树，通过一个受槽位容量约束的硅通孔连接，并利用硅通孔空间计数和热需求的 Pearson 相关系数量化热匹配。")
    para("求解先按网络跨度排序，通过带拥塞权重的 A* 逐一将引脚接入已有树，并对三端点局部树比较坐标中位点。问题二先用增广路径分配硅通孔，再在拆线重布中联合比较可用槽位和相应平面路径。每次改线用官方评分中的线长、溢出与热匹配项比较候选，保留得分最高的完整结构。")
    a,b,c,d = public
    para(f"官方评分器的四个公开算例均通过合法性检查，平面总溢出均为零。二维两例线长为 {a['result']['wirelength']} 和 {b['result']['wirelength']}，得分 {a['score']:.2f} 和 {b['score']:.2f}。三维两例线长为 {c['result']['wirelength']} 和 {d['result']['wirelength']}，热匹配分 {c['result']['H']:.2f} 和 {d['result']['H']:.2f}，得分 {c['score']:.2f} 和 {d['score']:.2f}。全部四个隐藏算例合法，其中一个二维算例仍有 3 单位溢出。两问机器分分别为 {official_summary[0]['final']:.2f} 和 {official_summary[1]['final']:.2f}。对照实验显示，拥塞代价降低了溢出，过大的热权重则会因线长增加而降低综合分。")
    para("关键词　全局布线，斯坦纳树，拆线重布，硅通孔，热匹配")
    page()

    head("一、问题重述与分析")
    para("全局布线为后续物理设计安排通道。一个网络的多个引脚形成树，可共用该网已有的分支。不同网络可以经过同一网格节点，但同一平面边只能提供有限通道。各网分别取最短路时，全局代价由相互竞争决定，因此单网最短的组合可能得分很低。")
    head("1.1 二维问题",2)
    para("给定所有边和容量，寻找覆盖每网全部引脚的树。零容量表示宏块阻挡，正容量边的溢出属于评分惩罚。线长与拥塞同时计分，在接近满载的边上给后续网络预留空间，可减少最后阶段的冲突。")
    head("1.2 双芯粒问题",2)
    para("跨层网必须用恰好一个 TSV。删除该边后，原树分成两棵连通的平面树。槽位影响两层的路径长度及平面需求，也通过其所在热格影响全芯片相关系数。因此先用全局可行分配解决硬容量，再用实际线路重评槽位。")
    head("二、模型假设与符号说明")
    para("布局、引脚与热需求均以原始输入为准。平面单位长度为 1，TSV 等效长度为 6，均为无量纲单位。引脚重合时只需覆盖该节点。正容量平面边允许溢出。热图是固定需求，Pearson 指标只衡量空间匹配。打开完整评分器时，运行时间按启动到退出的墙钟计量。")
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
    para("若任一选中连通分量不含根，该分量作为 U 会违反割约束，故选中节点连通。有限连通图的边数恰为节点数减 1 时无环。所有 cₑ=0 的边固定 xₙₑ=0；E 仅含输入列出的边。引脚集合只有一个实际节点时，空边集构成合法树。")
    head("3.2 容量及 TSV 约束",2)
    para("平面边需求 Dₑ=∑ₙxₙₑ，正容量平面边溢出为 Oₑ=max(0,Dₑ−cₑ)。跨层网的 TSV 边选择和等于 1，单层网等于 0，且单层网在另一层的节点变量固定为 0。对每一候选 TSV 边，要求 Dₑ≤cₑ。槽位以输入为准，题设规定有引脚的 GCell 不设槽位。两层即使投影坐标相同，节点也彼此独立。")
    head("3.3 官方目标函数",2)
    para("总线长 L 按选边代价求和。W 由参考线长归一化；正容量平面边的归一化溢出求平方和后得到 C。ρ 是热需求和 TSV 数在热格上的 Pearson 相关系数，任一向量零方差时取 ρ=0。热格索引中 x 在行内变化，y 为行号。")
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
    para("每一步选择与现有树曼哈顿距离最近的未接引脚，从该引脚用 A* 搜索至已有树的任一顶点。启发值取节点到树外接矩形的曼哈顿距离，由于边权至少为 1，此值不超过真实代价；相邻节点的该距离之差最多为 1，故启发式一致[1]。首次接触树时接入这条路径，新增路径的内部节点未在树中，连通且不产生环。三端点时另比较三个坐标的分量中位点作为候选起点，它在无障碍等权网格上对应最小直角连接。程序遇到障碍或拥塞时按实际路径权重择优。一般斯坦纳树精确算法的复杂度随端点数迅速增加[2]，此处用构造法控制运行时间。")
    head("4.2 容量匹配和热匹配",2)
    para("在两层分别计算正容量平面图的连通分量。跨层网只保留两端各位于对应引脚分量的槽位。候选以槽位到两层引脚包围盒的距离和排序，再用其到两层最近引脚的距离打破并列。容量匹配优先选择有余量的槽位；若不可直接分配，沿交替路径移动已分配网络，直到找到剩余容量。跨层网的输出由两棵平面树和一条 TSV 组合，因此仍为树。")
    para("重布跨层网时，备选中含原槽位、几何排序最靠前的至多三个有余量槽位，以及热权重大于零时按几何与热收益混合排序的至多三个槽位。混合排序用距离加 0.05 倍最近引脚距离，减去 2.5λ·max(Lref,1)·H/200。对同一热格只需算一次加入该热格后的 H。将双方真实树算出后，再用 0.45W＋0.25C＋0.20λH 评估整体。λ=0 的对照按线长与拥塞择优，最后依旧用官方权重评分。")
    head("4.3 拆线重布及校验",2)
    para("C、D、E 按平面包围盒跨度和引脚数降序初始化，A、B 保持输入顺序。D 进行三轮重布，E 默认七轮，并在每轮优先处理沿途溢出量之和较大的网络。撤销原路线的资源占用后生成新路线，按质量分及线长等打破并列。个别轮次允许在满载边更少时暂时接受逃逸方案，每轮结束比较并保留得分最高的完整合法结果。历史拥塞思想参考协商式布线[3]。二维和三维共用平面构造函数，三维只增加槽位分配及换槽。")
    para("独立验证直接读取输入与输出 JSON，拒绝重复键、重复边、未知或零容量边，逐网广度搜索并检查树边数、引脚覆盖、同层限制和 TSV 用量。其计分在程序外重新聚合边 ID，并与官方 grader.exe 的公开结果核对。求解器核心只依赖 Python 标准库。")
    destination.mkdir(parents=True,exist_ok=True)
    draw_flow(experiments/"flow.png")
    image(experiments/"flow.png","图1　容量匹配、成树、重布与验证流程",13)
    head("五、实验设计与结果")
    para("实验包含 A 基线、B 加拥塞权重、C 在 B 上增加网络排序、D 在 C 上增加拆线重布、E 综合优化。三维另有 cold 组，允许换槽但评价候选时关闭热项。二、三维各在两份公开数据上运行，汇总全部算法的线长、溢出、分数、运行时间和内存。官方验证在 Linux 的 Wine 10.0 兼容层使用 Windows Python 3.12.10 运行评分器 2.0.0，消融实验使用本地 Python 子进程，内存为每 5 毫秒采样的峰值 RSS。")
    table("表2　官方评分器运行结果",("算例","L","总/最大溢出","H","秒","MB","得分"),[
        (r["case_id"],r["result"]["wirelength"],f'{r["result"]["total_overflow"]}/{r["result"]["max_overflow"]}',
         f'{r["result"]["H"]:.2f}' if r["problem"]==2 else "—",
         f'{r["seconds"]:.2f}',f'{r["peak_memory_mb"]:.1f}',f'{r["score"]:.2f}') for r in official_rows
    ])
    para("公开四例的两个二维结果分别较参考线长多 0.82% 和 1.26%；三维公开两例分别多 9.34% 和 9.69%，TSV 恰为 130 和 295 个。一个二维隐藏算例溢出集中在三条边，每条 1 单位；另外七例均无溢出。所有案例均合法且资源符合上限。隐藏三维较弱的一例 W=40.74、H=54.66，表明在该实例上仍有明显的线长和热分优化空间。")
    table("表3　各算法公开算例本地综合分",("方案","Q1_P1","Q1_P2","Q2_P1","Q2_P2"),[
        (v,*[next((f'{r["score"]:.2f}' for r in rows if r["experiment"]==v and r["case"]==c),"—")
             for c in ("Q1_P1","Q1_P2","Q2_P1","Q2_P2")]) for v in ("A","B","C","D","E","cold")
    ])
    para("B 把四例总溢出由 63、120、45、108 降为 0、1、0、1。排序单独加入后，Q1_P1 的溢出由 0 变为 1，得分从 92.15 降到 80.18；Q1_P2 则由 84.50 升为 91.95。按跨度优先让较长网络先选择通道，但顺序仍会改变后续网络可用的通道。E 在四例的分数均高于 D，输出的公开路线与官方评分器产生的文件逐字节一致。")
    image(experiments/"comparisons.png","图2　公开算例本地运行时间与算法得分")
    image(experiments/"Q1_P1"/"paths.png","图3　Q1_P1 线长前十二个网络的路径与引脚",11)
    image(experiments/"Q2_P2"/"utilization.png","图4　Q2_P2 两芯粒的 GCell 容量利用率")
    para("图4 对每个 GCell 取相邻正容量平面边的最大需求容量比。深浅显示共享通道占用，统计以边为单位。每个公开算例的路径图及利用率图均由最终输出自动生成。")
    image(experiments/"Q2_P2"/"paths.png","图5　Q2_P2 的十二条较长网络与跨层连接",11)
    head("六、敏感性分析")
    para("固定原始输入与官方计分公式，仅改变求解参数。二维的 γ 使用 4、10、18 和 32，两个算例在七轮下均为零溢出，Q1_P1 分数范围为 98.09–98.22，Q1_P2 为 97.30–97.47。固定 γ=18，将迭代次数从 0、1、3 增至 7，两例均有持续改善。进一步迭代会增加耗时，接近 10 秒后需要把增益与时间扣分一并衡量。")
    para("开启热项使 Q2_P1 的 H 从 81.87 升至 90.03，线长增加 15；Q2_P2 的 H 从 74.51 升至 86.40，线长增加 48。二者综合分分别提高约 0.99 和 1.44。令 λ=4 时 H 上升至 97.47 和 94.98，但线长升至 3332 和 7154，最终分下降。λ=0.5 在 Q2_P2 得 82.99，高于默认值的 82.82；λ=1 在 Q2_P1 的表现更好。正式求解保持同一 λ=1。")
    image(experiments/"sensitivity.png","图6　热权重、拥塞惩罚和重布轮次的独立敏感性实验")
    head("七、模型评价与局限")
    para(f"自建 80×73×2 的 800 网络算例，含单引脚和 13 引脚网络、容量为 2 的 TSV、7×5 热图及禁边。固定随机种子 202611，算法在 {stress['seconds']:.2f} 秒通过独立校验，线长 {stress['wirelength']}、总溢出 {stress['total_overflow']}。自建算例的参考值仅用于运行测试，其综合分不纳入正式比较。")
    para("连通分量预筛与槽位容量匹配支持矩形网格、不同热图和多容量槽位。候选表空间最坏随跨层网数和 TSV 数的乘积增长；单次 A* 在最坏情况下访问一个芯粒的全部可达节点。稀疏邻接表和局部重布使本次测试的内存较低。求解规则按输入结构推导，源代码未按案例名分支。")
    para("顺序与局部搜索会造成局部最优，多个网络同时交换 TSV 或平面资源时可能产生更强的候选。包围盒代理不显式估计障碍绕行，候选截短可能丢掉优质槽位。隐藏算例的线长超参考值更明显，其中一例仍溢出。下一步可研究对拥塞瓶颈的成组重布，以及对多端点子树使用小规模精确求解。热指标没有模拟导热过程，热分的提高只表明计数与需求的空间相关性增强。")

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
