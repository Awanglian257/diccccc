from heapq import heappop, heappush


def tree(grid, pins, weights, reverse=False):
    """Attach the next pin by minimum-cost contact with the existing tree."""
    remaining = set(pins)
    root = max(remaining) if reverse else min(remaining)
    remaining.remove(root)
    vertices = {root}
    edges = []
    coords = grid.coords
    x0, y0, _ = coords[root]
    x1, y1 = x0, y0
    while remaining:
        pin = min(remaining, key=lambda p: (min(grid.distance(p, q) for q in vertices), -p if reverse else p))
        remaining.remove(pin)
        if pin in vertices:
            continue

        def heuristic(node):
            x, y, _ = coords[node]
            return max(x0-x, 0, x-x1) + max(y0-y, 0, y-y1)

        queue = [(heuristic(pin), 0, pin)]
        distance = {pin: 0}
        previous = {}
        while queue:
            _, cost, u = heappop(queue)
            if cost != distance[u]:
                continue
            if u in vertices:
                while u != pin:
                    u, edge = previous[u]
                    edges.append(edge)
                    vertices.add(u)
                    x, y, _ = coords[u]
                    x0, x1 = min(x0,x), max(x1,x)
                    y0, y1 = min(y0,y), max(y1,y)
                break
            for v, edge in grid.adj[u]:
                alt = cost + weights[edge]
                if alt < distance.get(v, float("inf")):
                    distance[v] = alt
                    previous[v] = (u, edge)
                    heappush(queue, (alt+heuristic(v), alt, v))
        else:
            raise ValueError("Pins cannot be connected within the tier")
    return edges
