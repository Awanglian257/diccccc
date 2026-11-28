import argparse
import json
from data_loader import Grid, read
from optimizer import solve


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--variant",choices=("A","B","C","D","E","cold"),default="E")
    parser.add_argument("--rounds",type=int)
    parser.add_argument("--penalty",type=float,default=18.)
    parser.add_argument("--thermal",type=float)
    args = parser.parse_args()
    result = solve(Grid(read(args.input)),args.variant,args.rounds,args.penalty,args.thermal)
    with open(args.output,"w",encoding="utf-8") as stream:
        json.dump(result,stream,ensure_ascii=False,separators=(",",":"))


if __name__ == "__main__":
    main()
