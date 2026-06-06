# Hysteretic Tensor Negotiation (HTN) — Project Overview

> **Status**: Active research / prototype. Last updated: May 2026.
> **Audience**: PhD committee, collaborators, senior contributors.

---

## 1. What is this project?

The HTN framework is a system for deploying AI-powered **care companions** — conversational agents that support individuals through chronic health challenges, behavioural change, addiction recovery, and mental health maintenance.

The distinguishing claim is that the framework is not merely prompt-engineering a large language model. It models the *physiological and psychological state* of the patient using a physically grounded mathematical structure (a Matrix Product State), and uses that state to constrain and guide what the LLM is allowed to say and when.

The companion is not a chatbot that tries to say the right thing. It is an agent that *adapts its strategy* in real time based on where the patient is in their recovery arc, what their body is doing (HRV, EDA, sleep deficit, glucose, circadian phase), and what the social network around them is saying.

---

## 2. Why this project?

### The clinical problem

Digital health companions exist — but they fail in predictable ways:

1. **They do not adapt to physiological state.** A companion that tries to discuss behavioural change with a patient who has just had a panic attack is clinically harmful.
2. **They ignore the care circle.** A patient's recovery is not an individual project. Caregivers, relatives, and clinicians each have partial information and often give contradictory advice. No current system coordinates these actors.
3. **They do not model extinction learning.** A patient who has suppressed a craving does not "forget" the craving — extinction is a new learning that competes with the original. Fear (craving, compulsion) can recover spontaneously, reinstate on a cue, or resurface under stress. A companion that treats each session as independent ignores this.
4. **They optimise the wrong thing.** LLM-based companions trained on "engagement" metrics become sycophantic. A companion that never challenges the patient is not therapeutically useful.

### The research hypothesis

> A companion whose response generation is constrained by a real-time physiological state model (the MPS layer) will achieve better clinical outcomes — measured by behaviour change stage advancement, sustained engagement, and reduced relapse — than a companion operating on prompt engineering alone.

This hypothesis is tested empirically through the A3C three-arm comparison (§ Training System).

---

## 3. Core concepts

### 3.1 The MPS layer

The patient's psychological state is represented as a **Matrix Product State** (MPS) — a tensor network structure borrowed from quantum many-body physics (Vidal, 2004). Each "site" in the chain encodes a different aspect of state:

- Semantic content (what is being discussed)
- Physiological bond (current arousal / stress)
- Action history (what the companion has already tried)

The MPS is evolved turn-by-turn using a **Lindblad-like master equation**:

```
dρ/dt = -i[H_eff, ρ] + Γ(ρ)
```

where:
- `H_eff` = effective Hamiltonian (semantic + physiological Hamiltonians combined)
- `Γ` = the autonomic recovery operator — how fast the patient's nervous system returns to baseline after a perturbation

The Γ operator is the locus of personalisation: it is modified by the patient's **pharmacological state** (PK/PD models), their **reactivity archetype** (hypersensitive, stoic, labile, ruminant), and their **hysteretic baseline** (long-term memory of past episodes).

### 3.2 Hysteretic baseline

Extinction learning in addiction and anxiety disorders does not erase the original conditioned response — it creates a *competing memory*. The HTN framework models this explicitly using a **three-component hysteretic baseline**:

| Component | Mechanism | Clinical analogue |
|---|---|---|
| **Fear weight** w(t) | Decays exponentially between sessions | Gradual recovery between therapy sessions |
| **Spontaneous recovery** | w partially restores after N weeks without exposure | Craving returns months after quitting |
| **Reinstatement** | Exposure to original cue spikes w | One drink triggers full craving return |

This is grounded in:
- Bouton (2002). Context, ambiguity, and unlearning. *Biological Psychiatry*, 52(10).
- Rescorla & Wagner (1972). Classical conditioning. *Classical Conditioning II*.
- Maren (2001). Neurobiology of Pavlovian fear conditioning. *Annual Review of Neuroscience*.

### 3.3 Social coupling (V_int)

When multiple companions are active in a care circle, their actions affect each other's patients through **social-physiological coupling**. The coupling matrix V_int is seeded with literature-grounded priors:

| Sender → Receiver | Coupling | Reference |
|---|---|---|
| Clinician → Patient | 0.60 | Roter (2002). Interaction Process Analysis |
| Caregiver → Patient | 0.40 | Hatfield et al. (1993). Emotional contagion |
| Patient → Caregiver | 0.35 | Pinquart & Sorensen (2004). Caregiver stressors |
| Patient → Clinician | 0.20 | Epstein et al. (2007). Participatory decisions |

After each speaker turn, V_int propagates the speaker's HRV delta to all other participants. A companion responding to the caregiver sees the patient's *predicted* updated physio — not a stale snapshot from the last patient turn.

### 3.4 Action taxonomy

The companion selects from a 41-action taxonomy spanning five strategic groups:

| Group | Examples |
|---|---|
| Rapport / MI spirit | `validate`, `empathic_reflection`, `acknowledge_only` |
| Information / psychoeducation | `psychoeducation`, `give_facts`, `direct_advice` |
| Change facilitation | `develop_discrepancy`, `motivational_frame`, `oars_summary` |
| Commitment / future-focus | `schedule_commitment`, `future_planning`, `relapse_plan` |
| Cross-circle relay | `companion_handoff`, `share_circle_insight` |

Each action carries a `CALMING_WEIGHT` ∈ [0,1] which determines its expected stress impact. This weight drives the synthetic reward signal in A3C training.

---

## 4. What we are NOT doing

- **Not building a medical device.** This is a research prototype. Clinical decisions are made by human clinicians.
- **Not replacing therapists.** The companion is a *between-session* support tool, not a therapy replacement.
- **Not claiming the MPS represents real quantum states.** The MPS is a mathematical ansatz that provides a compact, structured representation of high-dimensional psychological state. It is useful because it enforces locality and has known convergence properties — not because the brain is quantum.

---

## 5. System architecture (high level)

```
┌─────────────────────────────────────────────────────────┐
│                   Patient / User                        │
│           (WhatsApp / Web / Mobile interface)           │
└────────────────────────┬────────────────────────────────┘
                         │
               ┌─────────▼──────────┐
               │  Node.js Server    │   Express, port 8247
               │  Care Circle       │   CompanionCoordinator
               │  Orchestrator      │   Session Management
               └─────────┬──────────┘
                         │  HTTP
               ┌─────────▼──────────┐
               │  FastAPI / Python  │   tensornets, port 8765
               │  MPS Engine        │   MCTS, V_int, Physio
               │  A3C Training      │   Bedrock LLM backend
               └─────────┬──────────┘
                         │
               ┌─────────▼──────────┐
               │  AWS Bedrock       │
               │  Llama 4 Scout     │   Fast generation
               │  Llama 4 Maverick  │   Deep reasoning / judge
               └────────────────────┘
```

The Node.js layer handles conversation routing, user identity, privacy enforcement, and database persistence. The Python FastAPI layer handles all mathematical computation: MPS evolution, MCTS tree search, physiological state tracking, and A3C training. The two communicate over HTTP using a thin JSON API.

---

## 6. Primary references

| Citation | Role in project |
|---|---|
| Vidal, G. (2004). Efficient simulation of one-dimensional quantum many-body systems. *PRL 93*(4). | MPS representation, partial trace |
| Perez-Garcia et al. (2007). Matrix product state representations. *Quantum Information and Computation*. | MPS bond dimension, canonical forms |
| Bouton, M.E. (2002). Context, ambiguity, and unlearning. *Biological Psychiatry 52*(10). | Hysteretic baseline, extinction model |
| Miller & Rollnick (2013). *Motivational Interviewing* (3rd ed.). | MI spirit, FRAMES, OARS |
| Prochaska & DiClemente (1983). Transtheoretical model. *J. Consulting & Clinical Psychology*. | TTM stages, change stage advancement |
| Kerns et al. (2002). Temporal self-appraisal theory. | Longitudinal session continuity |
| Roter, D. (2002). The Roter Method of Interaction Process Analysis. | V_int clinician→patient coupling |
| Hatfield et al. (1993). Emotional contagion. *Current Directions in Psychological Science*. | V_int caregiver→patient coupling |
| Mnih et al. (2016). Asynchronous methods for deep RL. *ICML*. | A3C architecture |
| Kleiger et al. (2005). Heart rate variability. *Ann. Noninvasive Electrocardiol.* | HRV as stress proxy |
| Agelink et al. (2001). SSRIs and HRV. *Psychopharmacology*. | SSRI PK/PD model |
