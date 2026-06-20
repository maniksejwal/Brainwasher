# MCTS Four-Phase Loop

**Scale:** Algorithm level
**One idea:** What happens in a single MCTS iteration (one of 80–150 per turn)

```mermaid
flowchart TD
    START(["Current state\n|Ψt⟩ + zone Z"])

    SEL["① SELECT\nTraverse tree using UCB1 + A3C prior π(a|s)\nStop at unexplored node or leaf"]
    EXP["② EXPAND\nAdd child node for selected action\nPW gate: only if ncluster > Cpw · ncluster^α\n(α=0.5, Cpw=2.0)"]
    SIM["③ SIMULATE  (rollout)\nApply transition operator H^k|Ψt⟩\nLLM scores candidate actions\nCoT chain if CoT arm active"]
    BACK["④ BACKPROPAGATE\nUpdate Q̄c, nc, σ̂²c along tree path\nCritic V(s) as baseline"]

    ITER{Iteration\n< max?}
    DONE(["Output: ranked action list\n+ Mtrunc matrix"])

    START --> SEL --> EXP --> SIM --> BACK --> ITER
    ITER -- "yes" --> SEL
    ITER -- "no\n(80 or 150 iter)" --> DONE
```

## Tier structure within SELECT (HPVOOT only)

```mermaid
flowchart LR
    T1["Tier 1 — Cluster selection\n6 clusters\nUCB-V score:\nQ̄c + qbias + cexp√(lnN/nc) + cvar√(σ̂²c/nc)"]
    T2["Tier 2 — Action selection\n~8 actions in cluster\nStandard UCB1:\nQ̄a + c√(lnNc/na)"]
    ACT(["Selected action\na ∈ {0..51}"])

    T1 -- "chosen cluster c*" --> T2 --> ACT
```

## What each phase reads and writes

| Phase | Reads | Writes |
|---|---|---|
| Select | Q̄c, nc, σ̂²c, π(a\|s) from Actor | Tree path traversal |
| Expand | PW gate: nc, Cpw, α; LLM prior rank order | New child node |
| Simulate | H^k transition operator, LLM action scores | Rollout reward r |
| Backpropagate | r, V(s) from Critic | Q̄c ← (Q̄c·nc + r)/(nc+1), nc++, σ̂²c updated |
