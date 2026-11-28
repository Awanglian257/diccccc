import argparse
import json
import math
from collections import Counter, defaultdict, deque
from data_loader import read


def heat_score(heat, counts):
    h_mean = sum(heat) / len(heat)
    t_mean = sum(counts) / len(counts)
    h = [v - h_mean for v in heat]
    t = [v - t_mean for v in counts]
    denominator = math.sqrt(sum(v*v for v in h) * sum(v*v for v in t))
    return 50 * (1 + max(-1, min(1, sum(a*b for a, b in zip(h,t)) / denominator))) if denominator else 50.


def evaluate(data, solution, seconds=0, memory_mb=None):
    edges = {e["id"]: e for e in data["edges"]}
    nets = {n["id"]: n for n in data["nets"]}
    routes = solution["routes"]
    if solution["case_id"] != data["case_id"] or routes.keys() != nets.keys():
        raise ValueError("Case ID or net IDs differ from input")
    usage = Counter()
    for nid, ids in routes.items():
        if not isinstance(ids, list) or len(ids) != len(set(ids)):
            raise ValueError(f"{nid}: expected an edge list with unique IDs")
        pins = set(map(tuple, nets[nid]["pins"]))
        tiers = {point[2] for point in pins}
        graph = defaultdict(list)
        tsv_count = 0
        for eid in ids:
            edge = edges.get(eid)
            if edge is None or edge["cap"] == 0:
                raise ValueError(f"{nid}: unavailable edge {eid}")
            u, v = tuple(edge["u"]), tuple(edge["v"])
            if u[2] not in tiers or v[2] not in tiers:
                raise ValueError(f"{nid}: foreign tier")
            graph[u].append(v)
            graph[v].append(u)
            tsv_count += edge["kind"] == "tsv"
        if tsv_count != len(tiers)-1:
            raise ValueError(f"{nid}: wrong number of TSVs")
        root = min(pins)
        found = {root}
        queue = deque([root])
        while queue:
            for node in graph[queue.popleft()]:
                if node not in found:
                    queue.append(node)
                    found.add(node)
        if found != pins.union(graph) or len(ids) != len(found)-1:
            raise ValueError(f"{nid}: disconnected or cyclic routing")
        usage.update(ids)
    length = sum(edges[e]["cost"] * n for e, n in usage.items())
    reference = data["reference_wirelength"]
    wire = 100*math.exp(-4*max(0,length/reference-1)) if reference else 100.*(length == 0)
    overflow = []
    penalty = 0.
    heat = None
    if data["problem"] == 2:
        bx, by = data["heat"]["shape"]
        nx, ny, _ = data["shape"]
        counts = [0] * (bx*by)
    for eid, used in usage.items():
        e = edges[eid]
        excess = max(0, used-e["cap"])
        if e["kind"] == "tsv":
            if excess:
                raise ValueError(f"TSV capacity exceeded: {eid}")
            x, y, _ = e["u"]
            counts[(by*y//ny)*bx + bx*x//nx] += used
        elif excess:
            overflow.append(excess)
            penalty += (excess/e["cap"])**2
    congestion = 100 / math.sqrt(1+10*penalty)
    limit = data["limits"]
    time_score = 100 if seconds <= 10 else max(0,100*math.log10(limit["time_s"]/seconds)/math.log10(limit["time_s"]/10))
    if data["problem"] == 1:
        score = .55*wire+.35*congestion+.10*time_score
    else:
        heat = heat_score(data["heat"]["values"], counts)
        score = .45*wire+.25*congestion+.20*heat+.10*time_score
    resources_ok = seconds <= limit["time_s"] and (memory_mb is None or memory_mb <= limit["memory_mb"])
    return dict(legal=True, resources_ok=resources_ok, wirelength=length, total_overflow=sum(overflow),
                max_overflow=max(overflow,default=0), overflow_edges=len(overflow), wire_score=wire,
                congestion_score=congestion, heat_score=heat, time_score=time_score,
                score=score if resources_ok else 0., seconds=seconds, memory_mb=memory_mb)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--seconds", type=float, default=0)
    args = parser.parse_args()
    print(json.dumps(evaluate(read(args.input), read(args.output), args.seconds), indent=2))
