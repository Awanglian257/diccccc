import itertools
import unittest
from data_loader import Grid, unique_object
from evaluator import evaluate, heat_score
from optimizer import solve
from routing import tree
from tsv_optimizer import assign


def rectangular_case():
    nx, ny = 5, 3
    edges = []

    def add(u,v,kind,cap,cost):
        edges.append(dict(id=f"e{len(edges)}",u=u,v=v,kind=kind,cap=cap,cost=cost))

    for z,y,x in itertools.product(range(2),range(ny),range(nx)):
        if x+1 < nx:
            add([x,y,z],[x+1,y,z],"xy",int((x,y,z)!=(0,0,0)),1)
        if y+1 < ny:
            add([x,y,z],[x,y+1,z],"xy",2,1)
    add([2,1,0],[2,1,1],"tsv",2,6)
    return dict(schema_version=2,case_id="fixture",problem=2,shape=[nx,ny,2],edges=edges,
                nets=[{"id":"a","pins":[[0,0,0],[1,0,0],[3,1,1]]},
                      {"id":"b","pins":[[4,2,0],[0,2,1]]},
                      {"id":"single","pins":[[4,0,0],[4,0,0]]}],
                reference_wirelength=20,limits={"time_s":180,"memory_mb":2048},
                heat={"shape":[3,2],"values":[0,2,0,0,0,0]})


class ProjectTests(unittest.TestCase):
    def test_graph_and_tree(self):
        grid = Grid(rectangular_case())
        edges = tree(grid,grid.groups[0][0],[1]*len(grid.edges))
        self.assertEqual(len(edges),3)
        self.assertNotIn(0,edges)

    def test_rectangular_grid_capacity_and_single_pin(self):
        data = rectangular_case()
        result = solve(Grid(data))
        self.assertEqual(result["routes"]["single"],[])
        slot = data["edges"][-1]["id"]
        self.assertIn(slot,result["routes"]["a"])
        self.assertIn(slot,result["routes"]["b"])
        self.assertTrue(evaluate(data,result)["legal"])
        data["edges"][-1]["cap"] = 1
        with self.assertRaisesRegex(ValueError,"TSV capacity"):
            evaluate(data,result)

    def test_assignment_can_move_previous_owner(self):
        grid = Grid(rectangular_case())
        grid.cap[:2] = [1,1]
        options = {0:[0,1],1:[0]}
        self.assertEqual(assign(grid,options,options.__getitem__,[0,1]),{0:1,1:0})

    def test_repeated_edges_and_disconnected_parts(self):
        data = rectangular_case()
        result = solve(Grid(data))
        result["routes"]["a"].append(result["routes"]["a"][0])
        with self.assertRaisesRegex(ValueError,"unique"):
            evaluate(data,result)
        result = solve(Grid(data))
        result["routes"]["a"].pop()
        with self.assertRaises(ValueError):
            evaluate(data,result)

    def test_score_and_duplicate_keys(self):
        with self.assertRaises(ValueError):
            unique_object([("routes",{}),("routes",{})])
        self.assertEqual(heat_score([1,1],[0,2]),50)
        self.assertEqual(heat_score([0,2],[0,2]),100)
        self.assertEqual(heat_score([2,0],[0,2]),0)
        data = rectangular_case()
        result = solve(Grid(data))
        metrics = evaluate(data,result,seconds=180)
        self.assertEqual(metrics["time_score"],0)
        self.assertEqual(evaluate(data,result,seconds=181)["score"],0)


if __name__ == "__main__":
    unittest.main()
