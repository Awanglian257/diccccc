"""Exercise a generated 80×73, 800-net rectangular two-tier instance."""
import argparse
import json
import random
from pathlib import Path
from data_loader import read
from evaluator import evaluate
from experiments import run


def instance():
    rng = random.Random(202611)
    nx,ny = 80,73
    nets = []
    for i in range(800):
        x,y = rng.randrange(4,nx-4),rng.randrange(4,ny-4)
        pins = [[x,y,i%2]]
        if i != 0:
            for j in range(12 if i == 1 else 1+i%4):
                pins.append([x+rng.randint(-4,4),y+rng.randint(-4,4),j%2 if i%3==0 else i%2])
        nets.append(dict(id=f"n{i}",pins=pins))
    occupied = {(x,y) for net in nets for x,y,_ in net["pins"]}
    edges = []

    def add(u,v,kind,cap,cost):
        edges.append(dict(id=f"e{len(edges)}",u=u,v=v,kind=kind,cap=cap,cost=cost))

    for z in range(2):
        for y in range(ny):
            for x in range(nx):
                if x+1<nx:
                    add([x,y,z],[x+1,y,z],"xy",0 if x == nx//2 and y%8 else 4,1)
                if y+1<ny:
                    add([x,y,z],[x,y+1,z],"xy",4,1)
                if z==0 and (x+2*y)%6==0 and (x,y) not in occupied:
                    add([x,y,0],[x,y,1],"tsv",2,6)
    # This is only a scale placeholder. The official reference is not
    # computed for this synthetic fixture; its score is excluded.
    return dict(schema_version=2,case_id="stress",problem=2,shape=[nx,ny,2],
                edges=edges,nets=nets,reference_wirelength=8000,limits={"time_s":180,"memory_mb":2048},
                heat={"shape":[7,5],"values":[rng.randint(0,10) for _ in range(35)]})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out",type=Path,default=Path("stress-results"))
    args = parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    data = instance()
    source = args.out/"input.json"
    result = args.out/"output.json"
    source.write_text(json.dumps(data),encoding="utf-8")
    seconds,memory = run(source,result,[],data["limits"]["time_s"])
    measured = evaluate(data,read(result),seconds,memory)
    for key in ("score","wire_score","time_score"):
        del measured[key]
    report = json.dumps(measured,indent=2)
    (args.out/"metrics.json").write_text(report,encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
