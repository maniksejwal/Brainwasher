# Physiological Pipeline

**Scale:** Component level
**One idea:** How raw wearable signals become a HysteresisGate zone and an MPS update

```mermaid
flowchart LR
    subgraph SENSORS["Wearable Sensors"]
        HRV_RAW["HRV\nR-R intervals\nrMSSD ms"]
        EDA_RAW["EDA\nskin conductance"]
        SLEEP["Sleep quality\nscore"]
        GLUC["Glucose\nmg/dL"]
        REACT["Reactivity\narchetypemodifier"]
    end

    subgraph PHYSIO_MODEL["Physiological Model  (hrv.py · state.py)"]
        OU["Ornstein-Uhlenbeck\ndXt = θ(μ-Xt)dt + σdWt\nHRV smoothing"]
        NORM["Min-max\nnormalisation\nσ̂ᵢ ∈ [0,1]"]
        STRESS["Stress index\ns = 0.35σ̂HRV + 0.25σ̂EDA\n  + 0.20σ̂sleep + 0.10σ̂gluc\n  + 0.10σ̂react"]
    end

    subgraph GATE["HysteresisGate  (hysteresis_gate.py)"]
        SCHMITT["Schmitt trigger\ndead-band = 0.06"]
        ZONE["Zone Z ∈ {0,1,2,3,4}\ncalm · mild · moderate\nelevated · critical"]
        ACTIONS["Action gate\nsuppress confrontational\nactions in zones 3-4"]
    end

    subgraph MPS_UPDATE["MPS Update  (mps.py)"]
        DECAY["Decay rate\n|λ₁| = exp(-γΔt)\nmapped from HRV γ"]
        CORE["Core tensor update\nA⁽ᵗ⁾ ∈ ℝ^{χ×d×χ}"]
        VINT["Vint propagation\nv_int_propagate()\nHRV delta → other agents"]
    end

    HRV_RAW --> OU --> NORM
    EDA_RAW --> NORM
    SLEEP --> NORM
    GLUC --> NORM
    REACT --> NORM
    NORM --> STRESS --> SCHMITT --> ZONE --> ACTIONS
    STRESS --> DECAY --> CORE
    HRV_RAW --> VINT
```

## Zone table (ground truth from hysteresis_gate.py)

| Zone | Range | Name | Upward threshold | Downward threshold |
|---|---|---|---|---|
| 0 | [0.00, 0.25) | calm | s ≥ 0.25 | — |
| 1 | [0.25, 0.45) | mild tension | s ≥ 0.45 | s < 0.19 |
| 2 | [0.45, 0.60) | moderate | s ≥ 0.60 | s < 0.39 |
| 3 | [0.60, 0.78) | elevated | s ≥ 0.78 | s < 0.54 |
| 4 | [0.78, 1.00] | critical | — | s < 0.72 |

Dead-band = 0.06. Downward threshold = upward threshold − 0.06. This prevents rapid zone oscillation from small stress fluctuations.
