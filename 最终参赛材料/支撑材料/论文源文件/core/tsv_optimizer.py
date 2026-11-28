from collections import defaultdict, deque


def bounds(grid, group):
    x, y, _ = zip(*(grid.coords[p] for p in group))
    return min(x), max(x), min(y), max(y)


def slot_candidates(grid):
    slots = defaultdict(list)
    for s in grid.slots:
        a,b = sorted(grid.ends[s])
        slots[(grid.component[a], grid.component[b])].append(s)
    result = {}
    for n, groups in enumerate(grid.groups):
        for group in groups:
            if len({grid.component[p] for p in group}) != 1:
                raise ValueError("Input pins lie in disconnected planar components")
        if len(groups) != 2:
            continue
        box = [bounds(grid,g) for g in groups]
        candidates = []
        for s in slots[(grid.component[groups[0][0]],grid.component[groups[1][0]])]:
            a,b = sorted(grid.ends[s])
            x,y,_ = grid.coords[a]
            penalty = sum(max(x0-x,0,x-x1)+max(y0-y,0,y-y1) for x0,x1,y0,y1 in box)
            # The second key breaks ties between points inside a bounding box.
            proximity = min(grid.distance(a,p) for p in groups[0])+min(grid.distance(b,p) for p in groups[1])
            candidates.append((penalty, proximity, s))
        result[n] = sorted(candidates)
    return result


def assign(grid, candidates, ranked, order):
    owners = defaultdict(dict)
    assigned = {}
    for n in order:
        if n not in candidates:
            continue
        queue = deque([n])
        parent = {n: None}
        seen = set()
        last = None
        while queue and last is None:
            other = queue.popleft()
            options = ranked(other)
            for slot in options:
                if len(owners[slot]) < grid.cap[slot]:
                    last = (other,slot)
                    break
            if last is None:
                for slot in options:
                    if slot in seen:
                        continue
                    seen.add(slot)
                    for victim in owners[slot]:
                        if victim not in parent:
                            parent[victim] = other
                            queue.append(victim)
        if last is None:
            raise ValueError("No capacity-feasible TSV assignment")
        other,slot = last
        while other is not None:
            old = assigned.get(other)
            owners[slot][other] = None
            assigned[other] = slot
            if old is not None:
                del owners[old][other]
            other,slot = parent[other],old
    return assigned
