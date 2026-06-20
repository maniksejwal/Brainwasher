# HPVOOT Two-Tier Search Structure

**Scale:** Algorithm level
**One idea:** How 47 actions are searched in two tiers to avoid the branching-factor problem

```mermaid
flowchart TD
    ROOT(["Root: current MPS state\nzone Z known"])

    subgraph TIER1["Tier 1 — Cluster selection  (UCB-V bandit, 6 arms)"]
        DE["de_escalate\n10 actions\nbias +0.40 if Z=4\nbias +0.25 if Z=3"]
        EX["explore\n8 actions\nbias +0.20 if Z=0"]
        CH["challenge\n7 actions\nbias +0.15 if Z=1"]
        IN["inform\n6 actions"]
        ST["structure\n11 actions"]
        ME["meta\n5 actions\n(safety/terminal)"]
    end

    subgraph TIER2["Tier 2 — Action selection within cluster  (UCB1)"]
        A1["action 1\n(LLM-prior rank 1)"]
        A2["action 2"]
        AN["action n\nunlocked by PW gate\n≤ 2·√n visited so far"]
        RISKY["⚠ flooding_deepen\nescalate\n(last in queue)"]
    end

    SELECTED(["Selected action a*\ninjected into Mtrunc"])

    ROOT --> TIER1
    DE & EX & CH & IN & ST & ME -. "UCB-V score\n= Q̄ + qbias + exploration + variance" .-> DE
    DE -- "cluster c* chosen\n(highest UCB-V score)" --> TIER2
    A1 & A2 & AN --> SELECTED
    RISKY -. "only unlocked\nafter cluster\nwell explored" .-> AN
```

## Why two tiers reduce the problem

```mermaid
xychart-beta
    title "Visits per arm after 150 iterations"
    x-axis ["Flat (47 arms)", "Tier 1 (6 clusters)", "Tier 2 (~8 actions)"]
    y-axis "Mean visits per arm" 0 --> 30
    bar [3, 25, 19]
```

Flat MCTS with 150 iterations gives ~3 visits per arm across 47 actions — too few to trust the mean. Two-tier search gives ~25 visits at Tier 1 and ~19 at Tier 2, producing statistically reliable estimates at both levels.

## UCB-V score at Tier 1 (full equation)

```
score(c) = Q̄c  +  qbias(c, Z)  +  1.414 · √(ln N / nc)  +  0.40 · √(σ̂²c / nc)
             ↑         ↑                    ↑                        ↑
           mean    zone shortcut      exploration bonus         variance bonus
           reward   (from physio)     (UCB1 term)            (UCB-V addition)
```

The variance bonus keeps high-variance clusters (e.g., `challenge`) under exploration longer even after many visits, preventing premature commitment to a therapeutic mode that has a wide outcome distribution with this patient type.
