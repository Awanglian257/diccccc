import math
import time
from evaluator import heat_score
from routing import tree
from tsv_optimizer import assign, bounds, slot_candidates


def solve(grid, variant="E", rounds=None, penalty=18., thermal=None):
    size = len(grid.groups)
    order = list(range(size))
    if variant in {"C","D","E","cold"}:
        def difficulty(n):
            spans = [bounds(grid,g) for g in grid.groups[n]]
            return sum(x1-x0+y1-y0 for x0,x1,y0,y1 in spans), sum(map(len,grid.groups[n]))
        order.sort(key=difficulty, reverse=True)
    use_heat = grid.data["problem"] == 2
    heat = grid.data["heat"]["values"] if use_heat else []
    counts = [0] * len(heat)
    thermal = (1. if variant == "E" else 0.) if thermal is None else thermal
    candidates = slot_candidates(grid)
    assignments = assign(grid, candidates, lambda n: [s for _,_,s in candidates[n]], order)
    usage = [0] * len(grid.edges)
    weights = [1.] * len(grid.edges)
    history = [0.] * len(grid.edges)
    routes = [None] * size
    total = 0
    congestion = 0.
    reference = grid.data["reference_wirelength"]
    deadline = time.monotonic() + min(8., .75*grid.data["limits"]["time_s"])

    def excess(edge, count):
        return (max(0,count-grid.cap[edge])/grid.cap[edge])**2

    def weight(edge):
        if variant == "A":
            return 1.
        ratio = usage[edge] / grid.cap[edge]
        return 1 + .4*ratio**2 + penalty*max(0, ratio-(grid.cap[edge]-1)/grid.cap[edge]) + history[edge]

    def apply(route, delta):
        nonlocal total, congestion
        edges, slot = route
        total += delta*(len(edges)+6*(slot is not None))
        for edge in edges:
            previous = usage[edge]
            usage[edge] += delta
            congestion += excess(edge,usage[edge])-excess(edge,previous)
            weights[edge] = weight(edge)
        if slot is not None:
            usage[slot] += delta
            counts[grid.bin[slot]] += delta

    def planar(pins, reverse, improve):
        edges = tree(grid,pins,weights,reverse)
        if improve and len(pins) == 3:
            xs,ys,zs = zip(*(grid.coords[p] for p in pins))
            junction = grid.node((sorted(xs)[1],sorted(ys)[1],zs[0]))
            if junction not in pins and grid.component[junction] == grid.component[pins[0]]:
                alt = tree(grid,pins,weights,reverse,junction)
                if sum(weights[e] for e in alt) < sum(weights[e] for e in edges):
                    return alt
        return edges

    def construct(n, slot, reverse=False, improve=False):
        groups = grid.groups[n]
        if slot is None:
            return planar(groups[0],reverse,improve),None
        a,b = sorted(grid.ends[slot])
        return planar([*groups[0],a],reverse,improve)+planar([*groups[1],b],reverse,improve),slot

    def quality(route, heat_value):
        edges,slot = route
        length = total+len(edges)+6*(slot is not None)
        congest = congestion+sum(excess(e,usage[e]+1)-excess(e,usage[e]) for e in edges)
        wire = 100*math.exp(-4*max(0,length/reference-1)) if reference else 100.*(length == 0)
        c = 100/math.sqrt(1+10*max(0.,congest))
        score = (.45*wire+.25*c+.20*thermal*heat_value) if use_heat else (.55*wire+.35*c)
        return score, -length, -sum(usage[e]/grid.cap[e] for e in edges)

    for n in order:
        routes[n] = construct(n,assignments.get(n))
        apply(routes[n],1)

    if rounds is None:
        rounds = {"D": 3, "E": 7, "cold": 7}.get(variant,0)
    best_routes = routes.copy()
    best_score = quality(([],None), heat_score(heat,counts) if use_heat else 0)
    for iteration in range(rounds):
        if time.monotonic() > deadline:
            break
        for edge, count in enumerate(usage):
            if grid.edges[edge]["kind"] == "xy" and count > grid.cap[edge] and grid.cap[edge]:
                history[edge] += .4*penalty
                weights[edge] = weight(edge)
        revised = sorted(order,key=lambda n: sum(max(0,usage[e]-grid.cap[e]) for e in routes[n][0]),reverse=True)
        changed = 0
        for n in revised:
            if time.monotonic() > deadline:
                break
            old = routes[n]
            _, slot = old
            apply(old,-1)
            heat_cache = {}

            def score_for(s):
                if s is None or not thermal:
                    return 0.
                b = grid.bin[s]
                if b not in heat_cache:
                    counts[b] += 1
                    heat_cache[b] = heat_score(heat,counts)
                    counts[b] -= 1
                return heat_cache[b]

            best = old
            score = quality(old,score_for(slot))
            options = [slot]
            if slot is not None and variant in {"E","cold"}:
                available = [(d,p,s) for d,p,s in candidates[n] if usage[s] < grid.cap[s]]
                options.extend(s for _,_,s in available[:3] if s != slot)
                if thermal:
                    # Rank heat benefits in units of an equivalent length change.
                    coefficient = 2.5*thermal*max(reference,1)/200
                    ranked = sorted(available, key=lambda row: row[0]+.05*row[1]-coefficient*score_for(row[2]))
                    options.extend(s for _,_,s in ranked[:3] if s not in options)
            for option in options:
                improve = variant in {"E","cold"}
                route = construct(n,option,improve and bool(iteration % 2),improve)
                value = quality(route,score_for(option))
                if value > score:
                    best,score = route,value
            # On alternate sweeps allow congestion-driven escape moves. The
            # globally best complete legal solution is retained independently.
            if best == old and iteration % 3 == 1 and any(usage[e]>=grid.cap[e] for e in old[0]):
                trial = construct(n,slot,True)
                if sum(usage[e]>=grid.cap[e] for e in trial[0]) < sum(usage[e]>=grid.cap[e] for e in old[0]):
                    best = trial
            routes[n] = best
            changed += best != old
            apply(best,1)
        score = quality(([],None),heat_score(heat,counts) if use_heat else 0)
        if score >= best_score:
            best_score,best_routes = score,routes.copy()
        if not changed and iteration >= 2:
            break

    result = {}
    for net, (edges,slot) in zip(grid.data["nets"],best_routes):
        all_edges = edges if slot is None else [*edges,slot]
        result[net["id"]] = [grid.edges[e]["id"] for e in all_edges]
    return {"case_id": grid.data["case_id"],"routes": result}
