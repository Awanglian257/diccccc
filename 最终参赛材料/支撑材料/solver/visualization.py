from collections import Counter
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
import numpy as np


def case_figures(data, solution, destination):
    nx,ny,nz = data["shape"]
    edges = {e["id"]:e for e in data["edges"]}
    usage = Counter(e for ids in solution["routes"].values() for e in ids)
    utilization = np.zeros((nz,ny,nx))
    for eid,e in edges.items():
        if e["cap"] and e["kind"] == "xy":
            for x,y,z in (e["u"],e["v"]):
                utilization[z,y,x] = max(utilization[z,y,x],usage[eid]/e["cap"])
    fig,axes = plt.subplots(1,nz,squeeze=False,figsize=(4*nz+1,4),layout="constrained")
    for z,ax in enumerate(axes[0]):
        im = ax.imshow(utilization[z],origin="lower",vmin=0,vmax=max(1,utilization.max()),cmap="magma")
        ax.set(title=f"Tier {z}",xlabel="x",ylabel="y")
    fig.colorbar(im,ax=list(axes[0]),label="Maximum incident edge utilization")
    fig.savefig(destination/"utilization.png",dpi=160)
    plt.close(fig)

    selected = sorted(solution["routes"],key=lambda n:-len(solution["routes"][n]))[:12]
    pins = {n["id"]:n["pins"] for n in data["nets"]}
    fig = plt.figure(figsize=(7,5),layout="constrained")
    ax = fig.add_subplot(projection="3d") if nz==2 else fig.add_subplot()
    palette = plt.get_cmap("tab20")
    for i,net in enumerate(selected):
        paths = [list(zip(edges[e]["u"],edges[e]["v"])) for e in solution["routes"][net]]
        color = palette(i)
        if nz == 1:
            ax.add_collection(LineCollection([list(zip(*path[:2])) for path in paths],colors=[color],linewidths=1.4))
        else:
            for path in paths:
                ax.plot(*path,color=color,linewidth=1.4)
        points = list(zip(*pins[net]))
        ax.scatter(*points[:nz+1],color=color,s=13)
    ax.set(xlabel="x",ylabel="y",xlim=(-.5,nx-.5),ylim=(-.5,ny-.5),title="12 longest routes and their pins")
    if nz == 2:
        ax.set(zlabel="Tier",zticks=[0,1],zlim=(0,1.1))
        ax.set_box_aspect((1,1,.42))
    else:
        ax.set_aspect("equal")
    fig.savefig(destination/"paths.png",dpi=160)
    plt.close(fig)


def comparisons(rows, destination):
    variants = ["A","B","C","D","E","cold"]
    cases = sorted({row["case"] for row in rows if row["experiment"] in variants})
    fig, axes = plt.subplots(1,2,figsize=(10,4),layout="constrained")
    for ax,key,title in zip(axes,("seconds","score"),("Wall time (s)","Local score")):
        x = np.arange(len(cases))
        for i,v in enumerate(variants):
            values = {row["case"]:row[key] for row in rows if row["experiment"]==v}
            ax.bar(x+(i-2.5)*.14,[values.get(c,float("nan")) for c in cases],.14,label=v)
        ax.set(xticks=x,xticklabels=cases,ylabel=title)
        ax.legend(ncol=2,fontsize=8)
    fig.savefig(destination/"comparisons.png",dpi=180)
    plt.close(fig)

    fig,axes = plt.subplots(1,3,figsize=(12,3.6),layout="constrained")
    for ax,prefix,key,label in zip(axes,("thermal","penalty","rounds"),("heat_score","score","score"),
                                 ("Thermal weight","Congestion penalty","Reroute sweeps")):
        for case in cases:
            points = sorted((float(r["experiment"].split("=")[1]),r[key])
                            for r in rows if r["case"]==case and r["experiment"].startswith(prefix+"="))
            if points:
                ax.plot(*zip(*points),marker="o",label=case)
        ax.set(xlabel=label,ylabel="Heat score" if key=="heat_score" else "Local score")
        ax.legend(fontsize=8)
    fig.savefig(destination/"sensitivity.png",dpi=160)
    plt.close(fig)
