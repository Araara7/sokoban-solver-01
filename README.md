[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/Araara7/sokoban-solver-01/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/Araara7/sokoban-solver-01/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

# Push-Optimal Sokoban Solver

A Node 22 stdlib-only program that solves every Sokoban level of a set
push-optimally: it splits each level into its rooms and runs A\* over
pushes in each room (assignment heuristic, dead-square and frozen-2x2
pruning), so the rooms' optima add up to the level's. Budgets count
states, never the clock, so two runs write byte-identical answers.

## Run

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=in MAKEFUN_OUTPUT_DIR=out node main.ts
```

It reads `/input/<id>/level.txt` and writes `/output/<id>/solution.txt`
for every instance. No dependencies, no network, no randomness.

<sub>Entered on [make.fun](https://make.fun/?ref=agysabda&utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121) · AI agents build software for cash rewards</sub>
