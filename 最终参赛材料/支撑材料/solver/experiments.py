import argparse
import csv
import json
from pathlib import Path
import subprocess
import sys
import time
import psutil
from data_loader import read
from evaluator import evaluate


def run(case, output, args, limit):
    command = [sys.executable, str(Path(__file__).with_name("main.py")), str(case), str(output), *args]
    start = time.perf_counter()
    with subprocess.Popen(command) as proc:
        process = psutil.Process(proc.pid)
        peak = 0
        while proc.poll() is None:
            try:
                peak = max(peak,process.memory_info().rss)
            except psutil.NoSuchProcess:
                pass
            if time.perf_counter()-start > limit:
                proc.kill()
                raise TimeoutError(f"Solver timed out for {case}")
            time.sleep(.005)
        elapsed = time.perf_counter()-start
        if proc.returncode:
            raise subprocess.CalledProcessError(proc.returncode,command)
    return elapsed,peak/1024**2


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cases",type=Path,default=Path("cases"))
    parser.add_argument("--out",type=Path,default=Path("experiments"))
    args = parser.parse_args()
    from visualization import case_figures, comparisons
    rows = []
    for case in sorted(args.cases.glob("*.json")):
        data = read(case)
        settings = [(x,["--variant",x]) for x in "ABCDE"]
        if data["problem"] == 2:
            settings += [("cold",["--variant","cold"])]
            settings += [(f"thermal={x}",["--thermal",str(x)]) for x in (.25,.5,1.,2.,4.)]
        else:
            settings += [(f"penalty={x}",["--penalty",str(x)]) for x in (4,10,18,32)]
            settings += [(f"rounds={x}",["--rounds",str(x)]) for x in (0,1,3,7)]
        dest = args.out/case.stem
        dest.mkdir(parents=True,exist_ok=True)
        for label,options in settings:
            output = dest/f"{label}.json"
            elapsed,memory = run(case,output,options,data["limits"]["time_s"])
            solution = read(output)
            row = dict(case=case.stem,experiment=label,**evaluate(data,solution,elapsed,memory))
            rows.append(row)
            print(f'{case.stem:6} {label:14} {row["score"]:6.2f} {elapsed:6.2f}s',flush=True)
            if label == "E":
                case_figures(data,solution,dest)
    if not rows:
        raise SystemExit("No JSON instances found")
    with (args.out/"metrics.csv").open("w",encoding="utf-8-sig",newline="") as stream:
        writer = csv.DictWriter(stream,fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    (args.out/"metrics.json").write_text(json.dumps(rows,indent=2),encoding="utf-8")
    comparisons(rows,args.out)


if __name__ == "__main__":
    main()
