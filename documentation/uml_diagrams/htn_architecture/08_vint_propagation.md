# Vint Social Coupling Propagation

**Scale:** Component level
**One idea:** How a change in one user's physiological state reaches the other companions in the care circle

```mermaid
flowchart TD
    HRV_UPDATE(["Patient HRV update\nnew_hrv_ms = 42 ms\n(low HRV = high stress)"])

    subgraph STS["SharedTensorBuffer  (shared_tensor_state.py)"]
        PUT["put_mps(patient_companion)\nstore new MPS slot\ncalculate HRV delta"]
        DELTA["delta = 42 - prev_hrv\n(e.g. delta = -8 ms → stress spike)"]
        VINT_PROP["v_int_propagate(sender=patient)"]

        subgraph PROPAGATION["For each other agent in circle"]
            COUPLING["coupling = v_int(patient → receiver)\nfrom HystereticVIntStore\nor V_INT_PRIOR fallback"]
            PRIVGATE["Privacy gate\ncan this coupling propagate?\n(consent level check)"]
            APPLY["predicted_delta = coupling × delta\nreceiver HRV adjusted"]
        end
    end

    CG_SLOT["caregiver_companion slot\nHRV += 0.35 × delta"]
    CL_SLOT["clinician_companion slot\nHRV += 0.50 × delta"]

    HRV_UPDATE --> PUT --> DELTA --> VINT_PROP --> COUPLING --> PRIVGATE --> APPLY
    APPLY --> CG_SLOT
    APPLY --> CL_SLOT
```

## V_INT_PRIOR values (ground truth from shared_tensor_state.py)

```
          to patient   to caregiver   to clinician
patient      1.00          0.35           0.20
caregiver    0.40          1.00           0.15
clinician    0.60          0.25           1.00
```

Note: the paper's 3×3 matrix uses a simplified symmetric-ish form. The actual code has 6 directed pairs (no self-coupling stored explicitly). The asymmetry: `clinician → patient = 0.60` but `patient → clinician = 0.20`. Clinical authority flows down; patient feedback flows up weakly.

## Hysteretic alliance update

```mermaid
flowchart LR
    SIGNAL["A3C reward signal\npositive = good turn\nnegative = rupture"]
    HYST["HystereticVInt dead-band\n τ_high = 0.70\n τ_low  = 0.30\n dead-band = 0.08"]
    STORE["Alliance store\nper circle, persists\nacross sessions\n.json sidecar file"]

    SIGNAL --> HYST --> STORE
    STORE -. "loaded at\nsession open" .-> HYST
```

A well-established alliance (coupling > 0.70) resists a single bad turn. A damaged alliance (coupling < 0.30) does not snap back after one good turn. Same dead-band pattern as the physiological HysteresisGate.
