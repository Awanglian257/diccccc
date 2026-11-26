"""Build the anonymous editable paper from official and local experiment results."""
import argparse
from io import BytesIO
from collections import Counter
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
    title_properties = styles["Title"].element.pPr
    for item in title_properties.xpath("./w:pBdr"):
        title_properties.remove(item)
    normal = styles["Normal"].paragraph_format
    normal.first_line_indent = Pt(0)
    normal.widow_control = True
    normal.keep_with_next = False
    for grid in document.element.body.xpath(".//w:docGrid"):
        grid.getparent().remove(grid)
    for name in ("论文正文","论文图表"):
        st = styles.add_style(name,WD_STYLE_TYPE.PARAGRAPH)
        st.base_style = styles["Normal"]
        add_font(st,body_font,12 if name=="论文正文" else 10.5)
        st.paragraph_format.line_spacing = 1
        st.paragraph_format.first_line_indent = Pt(24 if name=="论文正文" else 0)
        st.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.LEFT if name=="论文正文" else WD_ALIGN_PARAGRAPH.CENTER

    def para(content):
        return document.add_paragraph(content,"论文正文")

    def center(content):
        p = document.add_paragraph(content)
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        return p

    def caption(content):
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
        label = caption(title)
        label.paragraph_format.keep_with_next = True
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
        document.add_paragraph(caption,"论文图表")

    public = [r for r in official_rows if r["visibility"]=="public"]
    logos = center("")
    for i,blip in enumerate(reversed(original.paragraphs[19]._p.xpath(".//a:blip"))):
        if i:
            logos.add_run("　　　")
        rel_id = blip.get(qn("r:embed"))
        logos.add_run().add_picture(BytesIO(original.part.related_parts[rel_id].blob),width=Cm(2.25))
    logos.paragraph_format.space_after = Pt(12)
    for line in ("杭州电子科技大学","2026 第八届新生数学建模竞赛"):
        p = center(line)
        p.paragraph_format.space_after = Pt(10)
        run = p.runs[0]
        run.bold = True
        run.font.size = Pt(17)
        run._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"),"Noto Serif CJK SC" if pdf_fonts else "楷体")
    title = document.add_paragraph("题　目　","Title")
    title.add_run("三维集成电路的多目标全局布线优化").underline = True
    title.paragraph_format.space_after = Pt(10)
    center("摘　　　要：").runs[0].bold = True
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
    head("3.1 从斯坦纳树到布线模型",2)
    head("3.1.1 为什么可以用树",3)
    para("普通最小生成树把给定顶点全部连起来。布线只要求引脚相通，因此允许选取额外网格点作分叉点，这对应图上的斯坦纳树。先固定其他网络和槽位，考虑某一网络的一组连通选边：若存在环，删去环上一边仍能保留引脚连通，而且会减少线长和边需求。跨层网络唯一的 TSV 必须连接两个芯粒，它不会落在这样的环上。因此用树描述布线与题设的合法性和优化方向一致。")
    para("每层正容量边构成一张有限图。若同层引脚都在同一连通分量，逐个沿路径接到已有连通子图就能把它们连齐，再删除环边可以得到一棵树。双层问题还需两层分量之间存在可用的 TSV 分配。这给出了建模可行性的图论解释，也说明为什么程序先筛选槽位再布线。")
    head("3.1.2 连通性和树边数",3)
    para("对网络 n 取一个引脚为根，令 xₙₑ 和 yₙᵥ 分别表示是否选边和顶点。每个引脚顶点固定 yₙᵥ=1。若边 e 的端点为 u、v，要求 xₙₑ≤yₙᵤ 且 xₙₑ≤yₙᵥ。对不含根的任意顶点集 U 和其中任一顶点 v，要求")
    formula("∑_{e∈δ(U)} xₙₑ ≥ yₙᵥ。")
    para("δ(U) 是一端在 U 内、另一端在 U 外的边集。若 U 中有选中顶点，至少有一条选中边向外。若一块选中顶点与根完全分离，取整块作 U 就会违反约束。")
    formula("∑_{e∈E} xₙₑ = ∑_{v∈V} yₙᵥ − 1。")
    para("连通已由割约束保证，再将选边数固定为选点数减一即可排除环。所有引脚重合时，单顶点和零条边也满足该等式。零容量边固定为不选，边集只含输入列出的边。")
    head("3.2 共享容量与跨层约束",2)
    head("3.2.1 平面边的需求和溢出",3)
    formula("Dₑ = ∑ₙ xₙₑ。")
    para("每个使用边 e 的网络为需求贡献 1。同网内部共用的一段路径已经由一个二元变量表示，无需重复计算。")
    formula("Oₑ = max(0,Dₑ−cₑ)。")
    para("该式用于正容量平面边。需求大于容量时，差值进入评分。容量为零的边禁止使用，因此也不参加归一化。")
    head("3.2.2 硅通孔的数量与硬容量",3)
    formula("∑_{e∈Eₜ}xₙₑ = kₙ−1。")
    para("kₙ 是网络引脚所占的芯粒层数。单层网络的右端为零，且另一层顶点固定不选。跨层网络的右端为一，两侧平面树通过唯一的 TSV 相连。")
    formula("Dₑ ≤ cₑ，　e∈Eₜ。")
    para("每个已选 TSV 槽位都必须遵守容量上限。题设规定有引脚的 GCell 不设候选槽位，程序直接读取输入中的槽位。")
    head("3.3 评分指标及其含义",2)
    head("3.3.1 线长与拥塞",3)
    formula("L = ∑ₙ∑ₑ ℓₑxₙₑ。")
    para("L 汇总所有网络的选边长度。每条平面边计 1，每个 TSV 计 6。")
    formula("W = 100 exp[−4 max(0,L/Lᵣₑ𝒻−1)]。")
    para("参考线长由题方提供，忽略容量、障碍与槽位竞争，端点超过 12 个时可能用近似值。超过参考值越多，线长分越低。题面未定义零参考值时的公式，本地按参考值趋近零的右极限处理。")
    formula("C = 100 / √[1+10∑_{e∈Eₚ, cₑ>0}(Oₑ/cₑ)²]。")
    para("无溢出时 C 为 100。若只有一条容量为 1 的边溢出 1 单位，C 约为 30.15。若同样的溢出出现在容量为 2 的边，C 约为 53.45。这个例子解释了程序为何优先消除小容量边上的拥塞。")
    head("3.3.2 热格归类与相关性",3)
    formula("b = ⌊Bᵧy/nᵧ⌋Bₓ + ⌊Bₓx/nₓ⌋。")
    para("Bₓ 和 Bᵧ 分别是热图两个方向的分格数，nₓ 和 nᵧ 是布线网格尺寸。先求行列号，再把行列号合成连续的热格编号 b。")
    formula("tᵦ = ∑_{e∈Eₜ,bin(e)=b} Dₑ。")
    para("把落入同一热格的槽位使用次数相加得到 tᵦ。这一步可以直接从路线和槽位坐标重算。")
    formula("ρ = ∑ᵦ(hᵦ−h̄)(tᵦ−t̄) / √[∑ᵦ(hᵦ−h̄)² · ∑ᵦ(tᵦ−t̄)²]。")
    para("hᵦ 是该热格的需求。减去均值后，若高需求位置通常同时有较多 TSV，分子倾向于为正。分母把结果归一化到 −1 与 1 之间。任一向量在各格都相同时按赛题取 ρ=0。")
    formula("H = 50(1+ρ)。")
    para("该式把相关性映射为百分制。H=50 对应零相关，H 越高表示空间匹配越强。")
    head("3.3.3 运行时间与综合分",3)
    formula("T = clip[100·log₁₀(τ/t)/log₁₀(τ/10),0,100]。")
    para("τ 是该例时限，t 是实际耗时。10 秒内 T 取 100，到达时限时 T 为 0。")
    formula("S₁ = 0.55W + 0.35C + 0.10T。")
    para("二维评分只用线长、拥塞和时间。")
    formula("S₂ = 0.45W + 0.25C + 0.20H + 0.10T。")
    para("三维把热匹配纳入评分。两问都先检查合法性和资源限制，违规时单例计零分。每问的机器分由公开均分和隐藏均分分别按 0.4 与 0.6 加权。")

    head("四、算法设计与独立验证")
    head("4.1 加权最短路与多端点树",2)
    head("4.1.1 给共享通道设定代价",3)
    para("令 uₑ 为已占用通道数，rₑ=uₑ/cₑ。在方案 B 至 E 中，将边权设为下式。γ 默认 18。hₑ 初始为零，每轮在溢出边上加 0.4γ。即将达到容量时，使用下一条网络的代价增大；历史项让反复拥堵的边更难入选。方案 A 的边权恒为 1。")
    formula("wₑ = 1+0.4rₑ²+γ max[0,rₑ−(cₑ−1)/cₑ]+hₑ。")
    para("基础代价 1 对应平面边长。第二项随利用率上升，第三项在通道满载后提高再占用的代价，最后一项记录以往出现的溢出。")
    head("4.1.2 用 A* 接入新的引脚",3)
    para('程序先取一个引脚作起点，从离当前树最近的未接引脚出发寻找接入路径。这里的距离为横向坐标差与纵向坐标差绝对值之和，即曼哈顿距离。A* 按已走代价与剩余代价下界之和选择下一步。剩余下界取到包住当前树的最小矩形的距离：接到树必先到达该矩形，而每步的代价至少为 1。相邻顶点到矩形的距离最多相差 1，因此启发式一致[1]。')
    para("找到新路径与树的第一个接触点时停止搜索。新路径只在这个点接入，因此不会形成环。举例说，三个引脚位于 (0,0)、(2,0)、(1,1)，在无障碍等权网格上，选择坐标中位点 (1,0) 作分叉点，三段共 3 条边。程序在处理三个端点时也试算这个中位点，并用实际边权比较。更多端点时，精确求解斯坦纳树的复杂度随端点数迅速增加[2]，逐次接入便于把时间控制在评分要求内。")
    head("4.2 容量匹配和热匹配",2)
    head("4.2.1 初始槽位的可行性",3)
    para('初始分配先排除无法接通的槽位。每层仅使用正容量边，把任意两点之间可以互达的区域称为连通分量。槽位的两端必须分别落在两层引脚所在的分量中。通过这项筛选后，用槽位到两层引脚包围盒的距离和排序，再用到两层最近引脚的距离打破并列。')
    para("如果最合适的槽位已满，直接跳过可能让后面的网络无处可选。设网络甲只能用槽位一，网络乙已占槽位一但也能用槽位二，且槽位二有空位。把乙迁到槽位二便能为甲腾出空间。程序通过增广路径在多个网络和槽位之间寻找这样的迁移链。")
    head("4.2.2 换槽后的整体比较",3)
    para('重布跨层网时，候选包括原槽位、几何排序最靠前的至多三个有余量槽位，以及启用热项时按几何与热收益混合排序的至多三个槽位。混合排序用包围盒距离加 0.05 倍最近引脚距离，再减去 2.5λ·max(Lref,1)·H/200。这个估计只用于缩小搜索范围。为每个候选算出两侧平面树后，用实际全局质量 0.45W＋0.25C＋0.20λH 作选择。λ=0 时只看线长和拥塞，报告实验结果仍使用官方权重。')
    head("4.3 拆线重布及校验",2)
    para('较长的网络通常需要跨过更多区域，故方案 C、D、E 先按各层引脚包围盒跨度之和排序，以引脚数打破并列，均从大到小。基线 A 和只加拥塞权重的 B 沿用输入顺序。D 至多重布三轮，E 默认至多七轮，并在重布时优先处理沿途溢出量较大的网络。')
    para("每次先撤掉一个网络的旧路径，把它占用的容量归还，再在其他网络仍在原位的条件下试算新路径。拥塞较重时，允许个别轮次暂时绕开满载边以腾出通道。每轮结束保留目前质量最高的完整解，达到轮数、停止条件或用时保护线后输出。反复拥塞的边在后续轮次中获得历史加价，这一思路与协商式布线有关[3]。")
    para('验证程序与求解器分别工作。它从 JSON 重新读入每个网络的边，先检查未知边、重复边和禁行边，再从一个引脚沿这些边逐层访问顶点。访问结果必须覆盖所有引脚和所选边的端点，且满足树边数条件。最后重新统计两层通道和 TSV 槽位占用，依照题目公式算分。公开结果还与原版评分器的输出相互核对。')
    destination.mkdir(parents=True,exist_ok=True)
    draw_flow(experiments/"flow.png")
    image(experiments/"flow.png","图1　容量匹配、成树、重布与验证流程",13)
    head("五、实验设计与结果")
    head("5.1 数据及计量环境",2)
    para('实验从简单方案逐项加入改动。A 用等权路径，B 补上拥塞权重，C 再调整处理顺序，D 加入重布，E 同时使用交替起点、三端点中位候选和双层换槽。双层另设不使用热项的 cold 组，以观察相同任务加入热目标后的变化。二维公开算例有 230 和 520 个网络，双层有 300 和 600 个网络。评分器 2.0.0 在 Linux 的 Wine 10.0 兼容层中调用 Windows Python 3.12.10。表2的时间与内存来自原版评分器，其他实验的内存是本地每 5 毫秒采样所得的进程常驻内存峰值。')
    head("5.2 官方成绩及误差来源",2)
    table("表2　官方评分器运行结果",("算例","L","总/最大溢出","H","秒","MB","得分"),[
        (r["case_id"],r["result"]["wirelength"],f'{r["result"]["total_overflow"]}/{r["result"]["max_overflow"]}',
         f'{r["result"]["H"]:.2f}' if r["problem"]==2 else "—",
         f'{r["seconds"]:.2f}',f'{r["peak_memory_mb"]:.1f}',f'{r["score"]:.2f}') for r in official_rows
    ])
    para('表2中，两个二维公开例分别比参考线长多 0.82% 和 1.26%，双层公开例分别多 9.34% 和 9.69%。四个公开例均无溢出，两个双层例分别布置了 130 和 295 个 TSV。二维隐藏例 Q1_H2 的三条边各溢出 1 单位，其余七例均无溢出。八例都通过合法性检查和资源限制。Q2_H1 虽无溢出，线长分只有 40.74，热匹配分为 54.66。这说明消除拥塞之后，槽位与路径的选择仍可能明显影响得分。')
    head("5.3 算法对照与路线图",2)
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
    head("6.1 平面拥塞权重与迭代次数",2)
    para("固定原始输入与官方计分公式，仅改变求解参数。二维的 γ 使用 4、10、18 和 32，两个算例在七轮下均为零溢出，Q1_P1 分数范围为 98.09–98.22，Q1_P2 为 97.30–97.47。固定 γ=18，将迭代次数从 0、1、3 增至 7，两例均有持续改善。进一步迭代会增加耗时，接近 10 秒后需要把增益与时间扣分一并衡量。")
    head("6.2 线长与热匹配的取舍",2)
    para("开启热项使 Q2_P1 的 H 从 81.87 升至 90.03，线长增加 15；Q2_P2 的 H 从 74.51 升至 86.40，线长增加 48。二者综合分分别提高约 0.99 和 1.44。令 λ=4 时 H 上升至 97.47 和 94.98，但线长升至 3332 和 7154，最终分下降。λ=0.5 在 Q2_P2 得 82.99，高于默认值的 82.82；λ=1 在 Q2_P1 的表现更好。正式求解保持同一 λ=1。")
    image(experiments/"sensitivity.png","图6　热权重、拥塞惩罚和重布轮次的独立敏感性实验")
    head("七、模型评价与局限")
    para(f"自建 80×73×2 的 800 网络算例，含单引脚和 13 引脚网络、容量为 2 的 TSV、7×5 热图及禁边。固定随机种子 202611，算法在 {stress['seconds']:.2f} 秒通过独立校验，线长 {stress['wirelength']}、总溢出 {stress['total_overflow']}。自建算例的参考值仅用于运行测试，其综合分不纳入正式比较。")
    para('单次 A* 最坏会访问一个芯粒内全部可达的顶点，跨层网络与槽位的数目同时增大时，候选表空间也会随两者乘积增长。本例用稀疏邻接表保存实际可走的边，并把重布限制在少量候选上。求解器只根据输入给出的大小、引脚、边和容量运行，因此矩形网格、不同热图和多容量槽位共用同一个流程。')
    para('网络顺序会影响早期留下的可用通道，逐网调整也可能停在局部最优。例如，两条网络若分别换槽都变差，同时交换槽位却有机会缩短总线。这类组合不在目前的搜索范围。包围盒距离只提供几何估计，存在障碍时可能漏掉实际代价较低的槽位。后续可对拥堵边周围的网络做成组重布，并在少引脚小区域内比较精确子树。热分衡量的是空间相关性，若要估计实际温升，还需材料、功率和边界条件。')


    page()
    head("八、结果诊断与有效性检查")
    head("8.1 二维通道的使用情况",2)
    head("8.1.1 从路线重算边使用次数",3)
    para("总溢出为零只能说明容量没有被突破。若很多边恰好满载，新增一条网络仍可能让局部拥塞。为同时观察这两点，表4读取四份公开输入和对应算法输出，对正容量平面边区分已用、满载和超载。满载指需求等于容量，超载指需求大于容量，两列互斥。")
    def use_counts(case, variant):
        source = load(Path("cases")/f"{case}.json")
        solution = load(experiments/case/f"{variant}.json")
        usage = Counter(e for route in solution["routes"].values() for e in route)
        positive = [e for e in source["edges"] if e["kind"]=="xy" and e["cap"]>0]
        pairs = [(usage[e["id"]],e["cap"]) for e in positive]
        return len(pairs),sum(d>0 for d,c in pairs),sum(d==c for d,c in pairs),sum(d>c for d,c in pairs)

    table("表4　初始等权算法和综合算法的平面通道占用",
          ("算例","方案","正容量边","已用边","满载边","超载边"),
          [(case,variant,*use_counts(case,variant))
           for case in ("Q1_P1","Q1_P2","Q2_P1","Q2_P2") for variant in ("A","E")])
    head("8.1.2 为什么先处理溢出",3)
    para("对所有正容量平面边，将归一化溢出的平方求和记为 q，则拥塞分随 q 单调降低。把某条边的溢出从 o 减到 o−1 时，q 的下降量为")
    formula("Δq = [o²−(o−1)²]/cₑ² = (2o−1)/cₑ²。")
    para("这个下降量随原溢出 o 增大，也随容量 cₑ 减小而增大。重布中优先访问溢出大的网络，可尽快试探能否解除这些冲突。若一条新路径减少本边拥塞，却在另一条容量更小的边上增加溢出，最终仍以全局的拥塞分和线长分判断。")
    para("表4的综合算法在四例中均已消除超载。满载边依然存在，这与图4中的高利用率位置相符。若实际设计要求预留备用容量，应另设通道余量目标，并用新的目标重新验证。")

    page()
    head("8.2 双层热格的布置差异",2)
    head("8.2.1 从 TSV 边恢复热格计数",3)
    para("热图匹配的改变可以从路线结果直接追溯。表5选取 Q2_P2，把冷方案与综合方案的 TSV 边端点按公式投影到热格，再统计每格的槽位使用次数。格坐标从零开始。差值表示综合方案相对于冷方案的使用次数变化。")
    case = "Q2_P2"
    data = load(Path("cases")/f"{case}.json")
    bx,by = data["heat"]["shape"]
    nx,ny,_ = data["shape"]
    bins = {e["id"]:(e["u"][0]*bx//nx,e["u"][1]*by//ny)
            for e in data["edges"] if e["kind"]=="tsv"}
    counts = []
    for variant in ("cold","E"):
        routes = load(experiments/case/f"{variant}.json")["routes"]
        counts.append(Counter(bins[e] for route in routes.values() for e in route if e in bins))
    assert sum(counts[0].values()) == sum(counts[1].values())
    table("表5　Q2_P2 各热格需求与 TSV 计数",
          ("热格 x,y","需求","冷方案","综合方案","差值"),
          [(f"({x},{y})",f'{data["heat"]["values"][y*bx+x]:g}',counts[0][x,y],
            counts[1][x,y],counts[1][x,y]-counts[0][x,y]) for y in range(by) for x in range(bx)])
    head("8.2.2 如何解读局部增减",3)
    para("两方案的 TSV 总数均为 295。每个跨层网络仍只用一个槽位，热分变化来自这一总量在各格中的重新分布。某个格子的 TSV 数可能减少，即便整体相关性提高。原因包括槽位容量、平面绕行，以及 Pearson 相关性以全图均值和方差为基准。")
    para("Q2_P2 在本地对照中的线长从 6878 变为 6926，拥塞分均为 100，热分从 74.51 变为 86.40。这样的变化可解释为用一部分额外布线代价换取更贴合热需求的空间布局。")

    page()
    head("8.3 验证覆盖与可复现性",2)
    head("8.3.1 按层检查合法性",3)
    para("一个解文件可以出现三类不同的结构错误。第一类是输入输出不对应，如网络遗漏或非法边 ID。第二类是单网内部结构不成立，如选边不能连到全部引脚或形成环。第三类只在多个网络合并后出现，如单个网络的 TSV 合法，但多个网络共用同一槽位导致超容量。验证程序先逐网检查前两类，再对所有路线汇总检查第三类。")
    para("检查连通性时，独立程序从一个引脚做广度搜索。搜索到的顶点集必须等于所有引脚和选边端点的并集。从全图只选一条与引脚无关的边，即使它本身没有形成环，也无法通过这项检查。对于所有引脚重合的网络，空边集只会访问一个顶点，满足连通和树边数条件。")
    head("8.3.2 记录可支持的结论",3)
    para("公开四例的输入、路线和指标可以一起复查。48 组本地实验逐组重算了线长、溢出和分数，重算值与已保存的实验表一致。耗时和内存引用原始运行记录。隐藏例的可核验材料是官方报告，不能用公开路线推算它们。自建 800 网络算例覆盖更多边界条件，其作用是测试求解和独立校验能否完成。")
    para("求解器没有随机布线步骤。固定的顶点编号和排序规则让同环境中的候选顺序可复现。若机器速度不同，求解器可能在不同轮次触发时间保护，因此复查时同时记录布线路径、合法性和资源用量。官方 Windows 程序通过兼容层运行所得的耗时也应按该环境解读。")
    head("8.3.3 两种检查器的职责",3)
    para("本地校验提供逐项指标和结构检查，便于定位失分。官方评分器给出隐藏算例、资源额度和机器分的最终证据。四个公开综合方案逐字节匹配官评输出，八例机器成绩均来自原始报告。因而可以同时追溯公开路线的每条边与完整评分过程。")

    page()
    head("参考文献")
    para("[1] Hart P E, Nilsson N J, Raphael B, A Formal Basis for the Heuristic Determination of Minimum Cost Paths, IEEE Transactions on Systems Science and Cybernetics, 4(2):100–107, 1968.")
    para("[2] Dreyfus S E, Wagner R A, The Steiner Problem in Graphs, Networks, 1(3):195–207, 1971.")
    para("[3] McMurchie L, Ebeling C, PathFinder: A Negotiation-Based Performance-Driven Router for FPGAs, Proceedings of the 1995 ACM Third International Symposium on Field-Programmable Gate Arrays, Monterey: ACM, 111–117, 1995.")
    page()
    head("附录")
    head("附录1　变量与代码对应",2)
    table("表6　变量和约束的程序表示",("数学对象","程序位置及变量"),[
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
    para("本项目使用 OpenAI Codex 辅助解读题目、建立模型、编写和调试程序、运行验证、绘制图表以及起草和修订论文。官方得分来自原版评分器生成的 report.json，算法对照来自本地实际运行保存的 metrics.json，文中的坐标和槽位迁移小例用于说明原理。工具型号、提示方式、采用情况及核验过程见支撑材料《AI工具使用详情.pdf》。")
    head("附录4　公开实验明细",2)
    for i,case in enumerate(("Q1_P1","Q1_P2","Q2_P1","Q2_P2"),start=7):
        if i in (7,9):
            page()
        head(f"附录4.{i-6}　{case}",3)
        relevant = [r for r in rows if r["case"]==case]
        table(f"表{i}　{case} 本地实验记录",
              ("配置","线长","总溢出","拥塞分","热分","用时/秒","内存/MB","综合分"),[
            (r["experiment"],r["wirelength"],r["total_overflow"],f'{r["congestion_score"]:.2f}',
             "—" if r["heat_score"] is None else f'{r["heat_score"]:.2f}',
             f'{r["seconds"]:.3f}',f'{r["memory_mb"]:.2f}',f'{r["score"]:.2f}')
            for r in relevant
        ])
        if i == 7:
            para("配置 penalty 与 rounds 分别表示拥塞惩罚系数和重布轮数。A 至 E 的参数沿用第 5 节，二维无热分。")
        if i == 9:
            para("配置 thermal 表示搜索时使用的热权重。所有配置结束后都按相同的官方权重计算综合分。")
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
