import json
from collections import defaultdict


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def read(path):
    with open(path, encoding="utf-8") as stream:
        return json.load(stream, object_pairs_hook=unique_object)


class Grid:
    def __init__(self, data):
        self.data = data
        self.nx, self.ny, tiers = data["shape"]
        self.area = self.nx * self.ny
        self.coords = [(x, y, z) for z in range(tiers)
                       for y in range(self.ny) for x in range(self.nx)]
        self.adj = [[] for _ in self.coords]
        self.edges = data["edges"]
        self.cap = [e["cap"] for e in self.edges]
        self.ends = [(self.node(e["u"]), self.node(e["v"])) for e in self.edges]
        self.slots = []
        self.bin = {}
        for i, edge in enumerate(self.edges):
            if not self.cap[i]:
                continue
            u, v = self.ends[i]
            if edge["kind"] == "xy":
                self.adj[u].append((v, i))
                self.adj[v].append((u, i))
            else:
                self.slots.append(i)
                x, y, _ = self.coords[u]
                bx, by = data["heat"]["shape"]
                self.bin[i] = (by * y // self.ny) * bx + bx * x // self.nx
        self.component = [-1] * len(self.coords)
        for root in range(len(self.coords)):
            if self.component[root] >= 0:
                continue
            stack = [root]
            self.component[root] = root
            while stack:
                for next_node, _ in self.adj[stack.pop()]:
                    if self.component[next_node] < 0:
                        self.component[next_node] = root
                        stack.append(next_node)
        self.groups = []
        for net in data["nets"]:
            groups = defaultdict(set)
            for pin in net["pins"]:
                groups[pin[2]].add(self.node(pin))
            self.groups.append([sorted(g) for _, g in sorted(groups.items())])

    def node(self, point):
        x, y, z = point
        return z * self.area + y * self.nx + x

    def distance(self, a, b):
        x, y, _ = self.coords[a]
        u, v, _ = self.coords[b]
        return abs(x-u) + abs(y-v)
