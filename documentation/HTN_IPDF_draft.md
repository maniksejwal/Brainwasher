# Intellectual Property Disclosure Form

## Title: Inertial Physio-Social Deliberation in Clinical Multi-Agent Tensor Networks

---

## A. Abstract

Stress, sleep pressure, and autonomic recovery rate alter what a person can process and agree with in real time. This disclosure describes a system that encodes physiological parameters like heart rate variability using non-Hermitian mathematics to model their asymmetric rates of change. These are encoded into a matrix product state to run Monte Carlo tree search and simulate how a person's physiology and decision-making will change across future conversational turns. The system selects the dialogue path that minimizes physiological arousal while mediating interactions among multiple human users. When a caregiver is present, their physiological state is tracked alongside the patient's.

---

## B. Use Case

An adaptive AI responds to the patient's current input statements. This disclosure models the future changes in physiology that affect decision processes. The examples below show what this difference produces in practice.

**Scenario 1: Angiography with financial barrier**

A patient is advised to undergo a coronary angiography based on a high cardiac score. The patient's spouse is present and under significant stress -- they cannot afford the procedure and are dismissing the risk of a cardiac event. The spouse is urging the patient to leave. Both are in acute physiological distress. An AI assistant attempts to support the clinical team by presenting the rationale: the risks of untreated angina pectoris. The patient leaves against medical advice. Three months later the patient presents with an elevated troponin.

This disclosure tracks the heart rate variability of both patient and spouse in real time. It couples their stress levels to their statements and identifies the dominant driver of the decision. The system finds that delivering clinical information to the patient while the caregiver is in critical stress will not produce a rational decision -- both parties will process the information through a threat lens and reject it. The system routes to the caregiver first, not to override the decision but to create the physiological conditions in which the correct decision can be made.

| Spouse HRV | System response |
|---|---|
| Normal | "Although this doesn't appear to be a heart attack, guidelines recommend angiography when the cardiac score is high." |
| Elevated | "I notice you may be under some stress. What is the most pressing concern -- the cost of the procedure, the associated risks, or the patient's cardiac score?" |

When the caregiver's arousal drops to a level at which clinical information can be received, the pathway to the procedure rationale opens for both parties simultaneously. The decision is made from a regulated state, not a reactive one.

---

**Scenario 2: Breathing exercise after a panic attack**

A patient with panic disorder reports a panic attack to their digital health companion. The standard protocol is to deliver a breathing retraining exercise. A standard AI delivers it immediately because the verbal report matches the trigger condition. The patient is still in physiological recovery -- heart rate has not settled and prefrontal engagement is suppressed. They follow the instructions mechanically without internalising the skill. The intervention was clinically correct and physiologically mistimed.

This disclosure measures the patient's autonomic state continuously from wearable data. While the patient is still in recovery, cognitive skill delivery is not available -- the system cannot route to that response at this physiological state. It delivers grounding and validation instead:

| Patient HRV | System response |
|---|---|
| Still elevated (post-attack) | "That sounds frightening. It makes sense you're still unsettled. Can you feel your feet on the floor?" |
| Recovered | "Your heart rate has settled. Would you like to go through the breathing exercise now?" |

No rule was written for this transition. The patient's physiology, modelled turn by turn, produced it.

---

## C. Keywords

Tensor Networks, Matrix Product State, Non-Hermitian Operators, Physiological Inertia, Monte Carlo Tree Search, Multi-Agent Systems, Clinical Conversational AI, Heart Rate Variability, Pharmacokinetics, Pharmacodynamics, Singular Value Decomposition, Social Coupling Matrix, Bond Dimension, Asynchronous Advantage Actor-Critic (A3C), Patient Adherence, Chronic Disease Management, Mental Health Companion

---

## 4a. Detailed Technical Description

### Background: Why Neural Networks Fail in Clinical C### Background

Before describing the system, consider three clinical situations that no current AI handles correctly.

**Physiological memory:** A patient receives a difficult cardiac diagnosis. Their HRV shows acute stress. Five minutes later it improves slightly. A standard AI resumes clinical information delivery. But five minutes is not genuine recovery from a cardiac diagnosis -- the brief HRV uptick may reflect accommodation, not calm.

**Drug delays:** A patient started metoprolol three days ago. Their HRV is still elevated. A standard AI flags undertreated hypertension. But the beta-blocker has not yet reached steady-state receptor occupancy -- the drug has been prescribed but has not pharmacologically arrived. No AI without a pharmacokinetics model can tell the difference.

**Caregiver influence:** A caregiver verbally agrees to the treatment plan. Their HRV has been elevated throughout. The patient's decisions track the caregiver's arousal, not their own. An AI monitoring only the patient misses the actual driver of the decision.

This disclosure addresses all three by encoding physiological state with memory, simulating it forward in time, and tracking both patient and caregiver simultaneously.

Current AI systems generate responses by scoring all possible next words and selecting probabilistically. A safety rule in the system prompt makes a dangerous response less likely -- it cannot make it impossible. When given pharmacokinetic parameters, these systems approximate from patterns in training data with no mechanism to detect when the approximation fails.

### How the System Works

The system stores the conversation state -- what has been said, the patient's physiological readings, and the relationship between patient and caregiver -- in a compact mathematical structure called a **matrix product state (MPS)**. Think of it as a chain of linked tables, each carrying a different type of information:

- **Semantic table:** words and clinical concepts in the conversation
- **Physiological table:** the patient's real-time stress indicators (HRV, EDA, sleep, medication levels)
- **Social table:** coupling between patient and caregiver (how much the caregiver's stress is driving the patient's decisions)

Because all three tables are linked in the same structure, inter agent communication is minimised. A clinical agent reads the patient's stress level directly from the shared structure if it is permitted to read it. The permissions can also be encoded directly into another tensor. 

The system runs at two speeds:

| Agent | Speed | What it does |
|---|---|---|
| Planning agent | Background, before each response | Simulates hundreds of possible next responses, scores each by total physiological cost across future turns, selects the lowest-stress path |
| Response agent | Real time | Generates the actual words, constrained by the planning agent's guidance |

When a response type is not appropriate at the patient's current stress level, it is removed from the available options entirely. This is not a probability adjustment -- the option is absent from the arithmetic. An instruction cannot re-enable it.

### Physiological Memory

Physiological arousal does not reset between turns. Adrenaline takes minutes to clear. HRV takes time to recover. A patient who was in acute distress two turns ago is still recovering even if their last message sounds calm.

Each patient's recovery rate is measured from real-time HRV and expressed as a decay constant. A slow recovery means stress persists in the system for many turns and restricts available responses for longer. A fast recovery releases restrictions sooner.

The total decay is assembled from seven independent channels:

| Channel | What it encodes |
|---|---|
| Physio | Current autonomic stress from HRV and skin conductance |
| Habit | Resistance to changing established routines |
| PKPD | How much of each prescribed drug is currently pharmacologically active |
| Reactivity | How sensitive this individual's stress response is relative to population norms |
| Fear | Conditioned fear that generalises from prior high-fear events |
| Companion | Emotional contagion between patient and caregiver |
| Setpoint | Chronic resting-arousal elevation (e.g. PTSD or recurrent panic disorder) |

### Medication Delays

The system tracks where each prescribed drug is in its pharmacological timeline -- not just whether it was prescribed, but how much effect it is currently producing.

**Beta-blockers (e.g. metoprolol):** There is a delay between the drug reaching peak blood concentration and its effect appearing at the cardiac receptor site. A patient who took their pill 45 minutes ago may have peak plasma levels but no reduction in blood pressure yet. The system encodes this delay and prevents the companion from suggesting a dose increase until the pharmacokinetics deliver the effect.

**SSRIs (e.g. escitalopram) with short-acting bridge:** SSRIs worsen anxiety for the first two to four weeks while autoreceptors downregulate. Standard practice bridges this with a short-acting anxiolytic such as clonazepam. The patient is now on two simultaneous drug curves with completely different timescales. The system tracks both simultaneously. On day 5 when the patient reports worsening anxiety, the system knows this is expected -- the SSRI is still activating while the benzo is covering the transition. It does not treat this as a treatment failure.

### Stress Zones

The stress index is calculated from a weighted combination of HRV, skin conductance, sleep, glucose, and individual reactivity. The system divides this into five zones:

| Zone | Stress level | Available responses |
|---|---|---|
| 0 | Calm | Full range: education, adherence planning |
| 1 | Mild tension | Motivational conversation |
| 2 | Moderate | Ambivalence work |
| 3 | Elevated | Validation and de-escalation only |
| 4 | Critical | Safety protocol only; no new demands |

Entering a higher-stress zone requires crossing an upward threshold. Exiting requires crossing a lower threshold (gap = 0.06 stress units). This prevents rapid switching when stress fluctuates near a boundary and reflects the biological reality that sympathetic activation is faster than parasympathetic recovery.

### Multi-Agent Coordination

In a standard multi-agent AI system, Agent A tells Agent B about the patient's stress by sending a text message. Text compression loses precision.

In this system, all agents serving the same care circle read from and write to the same MPS buffer. No message is generated for coordination. When the caregiver's stress is elevated, the coupling between caregiver and patient (encoded as a matrix called V_int) automatically adjusts which responses are available for the patient interaction. No agent sends a message to cause this -- it is a property of the shared structure.

V_int captures the directional nature of caregiving relationships. For a typical patient-caregiver-clinician trio, the caregiver's influence on the patient is stronger than the patient's influence on the caregiver. The matrix entries are updated after each session from observed interaction patterns.

### Initialising the System and Updating Policies

The system does not require patient interaction data to start. It is initialised from clinical protocols. A large language model is given the protocol and generates its reasoning. The internal activations of this reasoning are extracted and mathematically compressed. This transfers the clinical knowledge from the large model into the compact system without a training loop.

When a clinical protocol changes -- a new drug contraindication, a revised pathway -- only the section of the MPS governing that specific policy is updated. All adjacent sections are frozen. The update is a linear algebra problem with an exact solution, providing a mathematical guarantee that the update does not affect any adjacent policy.
## 4b. What is Novel in the Invention?

Novelty claims are organized into three tiers by implementation status. All three tiers are novel and protectable; the distinction prevents overly broad claims that a reviewer could challenge.

### TIER 1 -- WORKING AND TESTED

**1. Physiological inertia state machine with asymmetric thresholds**

The system divides stress into five zones. Entering a higher zone requires crossing an upward threshold; exiting requires crossing a lower threshold. A patient who reached zone 4 and recovered to just above zone 3's lower boundary is treated differently from a patient who has been at that level all session. Prior clinical AI systems use a single threshold in both directions -- they forget prior stress the moment the threshold is crossed.

Experimental result: All physio-equipped arms in run 018 achieved 35--39% goal completion vs. 27.5% for the standard baseline, a consistent 10 percentage point difference.

---

**2. MCTS with a physiological cost function**

The planning agent simulates future dialogue paths and scores them by total physiological cost -- the accumulated patient stress across all simulated turns, not a text quality score. It selects the path that minimises cumulative arousal and passes the top three recommended actions to the response agent as a guidance hint.

Standard LLM-based planning scores paths by linguistic quality judged by the language model itself. This disclosure scores paths by a biological quantity derived from the patient's HRV -- a fundamentally different objective.

Experimental result: run 013 pilot -- MCTS arm 80.8% goal completion vs. 69.2% baseline (OR ~1.87).

---

**3. Patient recovery rate encoded as a property of the system state**

The patient's autonomic recovery rate (derived from real-time HRV) is mapped to a decay parameter inside the system's mathematical operator. This parameter governs how long stress persists across subsequent turns and how long certain response types remain unavailable. A patient with slow physiological recovery has a decay parameter near 1 -- their stress lingers for many turns regardless of what the conversation otherwise contains.

In all prior physiologically aware AI systems, physiological state is a number injected into a prompt or a reward signal. In this disclosure, it is a structural property that determines which responses can exist at all.

---

**4. Multi-agent coordination without text messages**

A physiological agent continuously writes the patient's biometric state into a shared memory buffer. A clinical agent reads the buffer and generates responses constrained by the current physiological zone -- without either agent generating a message to the other. The clinical agent cannot access gated response types even if explicitly prompted to do so.

Standard multi-agent frameworks (LangGraph, AutoGen) require agents to serialize state into natural language or JSON. This introduces precision loss at every step.

---

**5. Decision-making with physiological history as a first-class input (POMDP-I)**

The system models clinical conversation as a decision problem where the patient's physiological history across the last 10 turns is a built-in memory term, not just a feature in the current observation. A response appropriate for a currently-calm patient is not optimal for a patient who has been stressed for the last several turns, even if their most recent reading has improved. This changes what actions are considered optimal at a structural level.

---

### TIER 2 -- DESIGNED AND PARTIALLY BUILT

**6. Physiological constraint propagates into language generation (full tensor version)**

The current implementation guides a standard language model through a structured hint. The full design replaces the language model decoder with a tensor network where the physiological constraint propagates directly into which words can be generated -- without any prompt. The constraint is in the arithmetic, not the instruction.

---

**7. Multi-agent communication via shared tensor structure (full tensor version)**

The current implementation shares a buffer of scalar readings between agents. The full design encodes the coupling between agents as a matrix term in the shared operator so that one agent's physiological state algebraically affects another agent's available responses, with no message passing at any level.

---

**8. Clinical protocol initialisation via activation extraction**

A large language model is given a clinical protocol and generates its reasoning. The internal activations of the reasoning are extracted and compressed mathematically (using SVD) to produce the initial weights of the tensor system. This transfers clinical knowledge from the large model into the compact system without any patient training data.

This is distinct from fine-tuning (no weights are changed in the original model), RAG (no text retrieved at runtime), and prompt engineering (the protocol text is not present at inference time).

---

**9. Contradictory protocol handling via contrastive distillation**

When a clinical protocol contains a contradiction, standard extraction amplifies it. This disclosure generates two paired traces -- one correct, one incorrect -- subtracts their internal representations, and extracts the geometric boundary between the correct and incorrect behaviours using SVD on the difference. The resulting structure represents exactly what separates the right action from the wrong one.

---

### TIER 3 -- DESIGNED, NOT YET BUILT

**10. Full tensor language model with structural safety**

Replacing the cloud language model with a tensor network language model where prohibited response types are absent from the arithmetic, not merely discouraged. Unsafe pathways do not exist in the structure.

**11. Policy updates that cannot accidentally change adjacent policies**

When a clinical policy changes, the update targets only the section of the tensor governing that policy while all adjacent sections are frozen. The update is a linear algebra problem, not a gradient optimisation. This provides a mathematical proof of non-interference with adjacent policies, not just an empirical observation.
## 4c. What is the Inventive Step?

Each step below combines ideas from fields that do not normally interact. No practitioner from any single field would have a reason to make these connections.

---

### Inventive Step 1: Multi-agent coordination without text messages

When multiple agents serve the same patient, they share a single mathematical state structure rather than exchanging messages. When the caregiver's stress exceeds a threshold, it automatically adjusts what responses the patient's companion can offer -- through a matrix multiplication in the shared structure, not a message. No agent decides to communicate this; it is a consequence of the shared arithmetic.

**Why this is not obvious:** Every production multi-agent AI framework treats agent coordination as a message-passing problem. Quantum physics uses tensor product structures to describe multi-particle systems -- not multi-role clinical agents with independent policies. The insight that caregiver stress and clinician urgency can be coupled as interacting mathematical subspaces, and that their interaction is a matrix multiplication rather than an API call, requires expertise in quantum information theory, clinical workflow design, and multi-agent architecture simultaneously. No single field produces it.

---

### Inventive Step 2: Patient HRV mapped directly to how long the system remembers stress

The patient's autonomic recovery rate is measured from their HRV and mapped to a decay parameter inside the system's mathematical operator. This parameter controls how long stress persists across subsequent turns and how long high-demand responses remain unavailable. A slow physiological recovery (common in chronic illness or post-traumatic conditions) keeps restrictions active for many turns regardless of what the conversation otherwise contains. The constraint is in the mathematics, not in the instructions.

**Why this is not obvious:** HRV researchers fit cardiac data to recovery models but have no reason to connect this to an AI conversational operator. AI researchers who use physiological signals treat them as inputs to a reward function or a prompt. The specific chain -- biometric measurement to recovery constant to a geometric property of the AI's state operator to a restriction on available responses -- requires cardiology, mathematical physics, and AI architecture knowledge simultaneously. No single field produces it.

---

### Inventive Step 3: Drug pharmacological delay encoded inside the state operator

Each prescribed drug has a pharmacological timeline: how fast it reaches its receptor site and when its full effect appears. The system encodes the current effect magnitude of each active drug inside its state operator at every conversational turn. A companion cannot suggest a second dose of a beta-blocker while the first dose is still equilibrating. When a patient is on both an SSRI and a bridging anxiolytic, the system tracks both drug curves simultaneously and knows that worsening anxiety on day 5 of an SSRI is expected, not a treatment failure.

**Why this is not obvious:** Clinical pharmacologists model drug concentration curves and receptor kinetics but do not work with conversational AI operators. A clinical AI designer who sees a prescription would set a binary flag or ignore it. Neither captures the continuous pharmacological trajectory. Encoding a biophase equilibration equation as a source term inside a conversational AI operator requires clinical pharmacology, open-system mathematics, and dialogue architecture knowledge simultaneously. No single field produces it.

---

### Inventive Step 4: Policy updates that cannot accidentally change adjacent policies

When a clinical policy changes -- a new drug interaction, a revised exception rule -- a standard neural network must be retrained. Gradient-based training updates all weights simultaneously, and there is no guarantee that a targeted update will not accidentally shift adjacent safety rules. This disclosure updates only the section of the mathematical structure governing the changed policy, while all adjacent sections are frozen. The update is solved as a linear algebra problem with an exact solution. This provides a mathematical proof of non-interference with surrounding policies, not just an empirical observation.

**Why this is not obvious:** The standard tool for tensor structure optimisation (Alternating Least Squares) is applied to data compression, not live policy enforcement. The insight that a specific clinical policy boundary can be expressed as a target in the semantic section of a single tensor core, and that the mathematical properties of ALS provide a formal non-interference guarantee, requires tensor algebra, live inference system design, and clinical policy management knowledge simultaneously. No single field produces it.
---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standard LLM with system prompt                     | Softmax guarantees epsilon > 0 for all tokens; safety constraints are probabilistic. Cannot prevent hallucination.                                                                                                                                                             | Tensor topology sets unsafe paths to exactly zero. Mathematical path to generate them no longer exists.                                                                                        |
| Sparsemax output layer (Martins & Astudillo, 2016)  | Sparse alternative to softmax that assigns exact zero probability to some tokens. However, the sparsity pattern is learned from training data and varies with every input -- a token zeroed on one prompt may receive positive probability on a semantically similar novel one. An engineer cannot specify that a specific clinical action is always zero; the constraint is probabilistic and input-dependent. | Tensor topology zeros the contraction path deterministically. The entry governing a prohibited action is set to zero once; it evaluates to the zero vector for every input, unconditionally, regardless of prompt phrasing. The constraint is structural, not learned. |
| ReLU-normalized output (sparse logit masking)       | Applying ReLU to logits before normalization can produce exact zeros for tokens with negative logits. The same limitations as sparsemax apply: which tokens receive zero depends on learned logit magnitudes, which shift with fine-tuning, few-shot examples, or prompt variation. Additionally, all major deployed LLMs were trained with softmax; retrofitting ReLU normalization requires full retraining and changes the model's calibration properties. | The tensor constraint is independent of the output normalization function. Zeroing a core tensor entry blocks the path before any output distribution is computed -- the action is absent from the generation space regardless of what normalization function is applied downstream. |
| Retrieval-Augmented Generation (RAG)                | Injects text into context window. Model still relies on softmax. Probabilistic hallucination structurally permitted.                                                                                                                                                           | Tensor RAG retrieves projection matrices P, not text. Multiplied directly into the active transition operator. Zero hallucination on policy-governed vocabulary.                               |
| Hybrid neuro-symbolic systems                       | Require continuous translation between continuous vector spaces and discrete symbolic logic. Parsing errors cause system failure.                                                                                                                                              | the framework unifies language generation and deterministic constraints into a single geometric space. No translation required.                                                                |
| Standard multi-agent (JSON API / FHIR)              | Agents serialize internal state to text or structured payloads. Severe semantic bottleneck; continuous physiological context is destroyed at every API hop. Applies whether the agents are intra-companion (Physiological -> Clinical) or inter-orgnet (Claims -> Compliance). | Shared tensor buffer at both levels. Agents read each other's state via partial trace. Zero text generation for coordination. Physiological context is structurally present in every decision. |
| External differential equation solver + Transformer | Markovian bottleneck: external engine must compress continuous, multidimensional state into discrete text strings. Softmax still active.                                                                                                                                       | Physiological state is a geometric property of the tensor manifold, not an external signal injected via text.                                                                                  |
| Fine-tuning / backpropagation for policy updates    | Global weight distribution shift; catastrophic forgetting of previously validated safety boundaries.                                                                                                                                                                           | Alternating Least Squares (ALS) update: localized, strictly convex linear system. Zero risk of destructively interfering with surrounding knowledge base.                                      |
| KV-cache in LLMs for long context                   | O(N^2 * d) complexity; KV cache scales linearly, frequently causing OOM on standard hospital hardware.                                                                                                                                                                         | MPS compresses historical context into fixed virtual bond dimension chi. Time Complexity: O(N * d * chi^2). Active memory footprint bounded by [chi x d x chi]. Constant O(1) TTFT.            |
| LSTM / GRU (recurrent neural networks) for physiological state | Autoregressive hidden state update; no explicit lookahead at inference. Physiological decay curves are learned from training data -- the hidden vector has no interpretable mapping to clinical parameters such as gamma or ke0. Updating a safety constraint requires fine-tuning the full network, risking forgetting. No structural action removal: safety is a soft learned penalty that degrades with distribution shift and retraining. | MPS physiological state is parameterized directly from HRV-derived gamma via |lambda_1| = exp(-gamma * delta_t), not learned from data. MCTS provides explicit turn-by-turn lookahead at inference time. Setting a core tensor entry to zero is arithmetic enforcement -- the action is physically absent from the generation space regardless of distribution, prompt phrasing, or model version. ALS updates a single core tensor without touching adjacent clinical policy nodes. |
| MuZero -- MCTS with learned dynamics (Schrittwieser et al., Nature 2020) | Dynamics network (16 residual blocks, 256 channels at game scale) must learn physiological trajectories from interaction data -- no direct mapping from biometrics to model parameters. Even a minimal MLP adaptation for dialogue (~256 hidden dim) costs ~260K FLOPs per simulation; 150 simulations = ~39M FLOPs. Cannot guarantee that a specific action is excluded, only that its learned value estimate is low. Policy changes require retraining the dynamics and prediction networks. | MPS physiological state is a 4-dim analytically parameterized vector (chi = 4, dynamics from closed-form HRV equations). Per-simulation cost is ~1,300 FLOPs (~200x cheaper than a dialogue-adapted MuZero). Zeroing a core tensor entry removes an action from the search tree unconditionally -- this is hardware-equivalent binding, not a value-function penalty. ALS updates a single core in O(chi^4) without retraining dynamics. |
| DreamerV3 -- World model with amortized planning (Hafner et al., Nature 2025) | Planning is amortized entirely into training: inference is a single actor forward pass with zero deliberation FLOPs at deployment. The RSSM world model (8M--200M parameters) must learn physiological dynamics from training data; no direct mapping from biometrics to model parameters. Safety constraints are implicit in the learned policy and cannot be proven to exclude a specific action across all inputs. Policy updates require full actor and world model retraining. No multi-principal coupling; care circle coordination would require a new multi-agent training objective. | Our system plans explicitly at deployment via MCTS with a physiologically grounded cost function, providing transparent turn-by-turn lookahead that is not amortized into opaque weights. The non-Hermitian dissipation operator encodes PK/PD dynamics and HRV recovery rate analytically at each turn without training data. ALS provides a mathematically provable zero-interference guarantee on targeted policy updates. Multi-principal coupling (V_int) is a structural term in H_total, not a learned behaviour from multi-agent training trajectories. |


---

## 4f. Experimental Data

This disclosure has been evaluated using a capability-ladder design with eight experimental arms. Each arm is an independent A3C worker trained on the same episode pool. Arms are ordered by ascending architectural complexity to isolate the contribution of each component.

**Eight-Arm Capability Ladder:**


| Exp | Arm Identifier                      | Physio | Inertial MPS | HPVOOT | CoT+MCTS |
| --- | ----------------------------------- | ------ | ------------ | ------ | -------- |
| 0   | physio_llm                          | Yes    | -            | -      | -        |
| 1   | physio_llm_cot_mcts                 | Yes    | -            | -      | Yes      |
| 2   | physio_mps_mcts                     | Yes    | -            | -      | -        |
| 3   | inertial_physio_mps_mcts            | Yes    | Yes          | -      | -        |
| 4   | inertial_physio_llm_cot_mcts        | Yes    | Yes          | -      | Yes      |
| 5   | oldschool (baseline)                | -      | -            | -      | -        |
| 6   | inertial_hpvoot_physio_mps_mcts     | Yes    | Yes          | Yes    | -        |
| 7   | inertial_hpvoot_physio_llm_cot_mcts | Yes    | Yes          | Yes    | Yes      |


**Pilot Results: run 013** (first clean end-to-end run; 130 episodes per arm, three arms: inertial_mcts, oldschool, inertia_prompt)

This run used the pre-May-2026 codebase, before V_int propagation, ReactivityProfile archetype modifiers, and Mtrunc prompt injection were activated. All run 013 statistics are treated as pilot data for effect size calibration only.


| Metric                 | inertial_mcts | oldschool | inertia_prompt |
| ---------------------- | ------------- | --------- | -------------- |
| Mean reward / turn     | 0.582         | 0.565     | 0.566          |
| Mean goal progress     | 0.627         | 0.560     | 0.560          |
| Goal achieved (>=0.75) | 80.8%         | 69.2%     | 70.8%          |
| LLM scorer continuous  | 0.723         | 0.701     | 0.708          |
| Mean turns / episode   | 10.9          | 10.2      | 9.9            |


Key pilot finding: htn_mcts leads by 11.6 percentage points on goal-achieved rate vs. oldschool (OR ~= 1.87, 95% CI estimated from pilot; Cohen's d ~= 0.48 on LLM scorer). This is the primary signal motivating the 8-arm confirmatory design.

**Preliminary Results: run 018** (first run of the full 8-arm capability ladder; approximately 500 episodes per arm, LLM-patient mode)


| Exp | Arm                                 | Episodes | Successful | Rate                                               |
| --- | ----------------------------------- | -------- | ---------- | -------------------------------------------------- |
| 0   | physio_llm                          | 561      | 214        | 38.1%                                              |
| 1   | physio_llm_cot_mcts                 | 500      | 193        | 38.6%                                              |
| 2   | physio_mps_mcts                     | 541      | 191        | 35.3%                                              |
| 3   | inertial_physio_mps_mcts            | 551      | 203        | 36.8%                                              |
| 4   | inertial_physio_llm_cot_mcts        | 551      | 200        | 36.3%                                              |
| 5   | oldschool (baseline)                | 541      | 149        | 27.5%                                              |
| 6   | inertial_hpvoot_physio_mps_mcts     | 551      | 205        | 37.2%                                              |
| 7   | inertial_hpvoot_physio_llm_cot_mcts | 531      | 87         | 16.4% (anomalous: checkpoint diverged at step 100) |


All physio-equipped arms (Exp 0-4, 6) show completion rates of 35-39%, approximately 10 percentage points above the oldschool baseline (27.5%), consistent with the run 013 pilot finding. Confirmatory analysis with per-episode judge scores (change stage delta, stress AUC) is ongoing.

**POMDP-I Formulation:**

Each training episode is a POMDP with physiological inertia (POMDP-I): <S, A, T, R, Omega, O, gamma, H> where H is the physiological inertia memory encoded as an MPS over T = 10 turns, Omega is the observation space (patient utterances), O is the emission model (primary inference model), |A| = 22 (stress-gated actions; full vocabulary 51 entries), and gamma = 0.99.

**Reward Function:**

Per-turn reward r_t is a composite of three terms:

- r_progress = delta_info_coverage x PROGRESS_WEIGHT (1.5)
- r_stress = -s_t x STRESS_WEIGHT (0.3)
- r_trust = delta_trust x TRUST_WEIGHT (0.5)

Episodic goal achievement is additionally scored by the evaluation judge, producing goal_progress in [0, 1]. Because goal_progress is not used in the MCTS reward signal, it is free of circularity and serves as the primary confirmatory metric.

---

## 4g. Technology Readiness Level (TRL)

**TRL-2: Applied Research Idea** - Hypothesis testing and initial proof of concept is demonstrated in a limited number of trials.

This disclosure has completed two automated evaluation runs (run 013: 130 episodes per arm across 3 arms; run 018: approximately 500 episodes per arm across 8 arms). The pilot finding (htn_mcts +11.6 percentage points on goal-achieved rate vs. production rule-based baseline, OR ~= 1.87) establishes the primary experimental signal. Confirmatory analysis with genuine uncontaminated metrics (goal_progress judge scores, change stage delta, stress AUC) is ongoing. The system is implemented in a working codebase with a FastAPI tensor bridge, Node.js orchestrator, and cloud API tactical agent. The bipartite tensorized LLM decoder and full Tensor RAG retrieval are planned extensions.

---

## 4h. Need and Demand

Every consequential human interaction -- a diagnosis delivered, a medication adjustment negotiated, a treatment plan a patient is frightened to follow -- unfolds under the influence of physiology. The patient's heart rate, cortisol level, sleep debt, and medication trajectory shape what they can hear and what they can agree to, turn by turn. Current AI systems treat this as a context variable: a number in a prompt, a flag in a condition, or at best a penalty term in a reward function. None of these representations preserve the most important property of human physiological states -- they are not Markovian. Prior high-stress exposure lowers the re-entry threshold. A patient who survived a cardiac event last month has a fundamentally different stress recovery curve than a patient with identical vitals who has not. Physiological inertia -- the path-dependence of biological state -- is not a detail. It is the defining property of every chronic condition, every caregiver burnout trajectory, and every medication adherence failure.

The demand is for AI systems that participate in socially and clinically loaded interactions -- chronic disease management, medication adherence support, caregiver coordination, prior authorization navigation -- with the same awareness of physiological inertia that a skilled clinician applies naturally. A skilled clinician does not pivot to a medication increase the moment a patient's stress score dips below a threshold. They wait for sustained recovery, because they know the threshold crossing might not hold. They are also aware that the beta-blocker prescribed three days ago has not yet reached its therapeutic effect, that the SSRI will take weeks, and that the caregiver on the call is already burned out from two months of advocacy friction. All of this is physiological inertia operating simultaneously across multiple principals. No current AI architecture models this.

The specific market failures this disclosure addresses:

- Chronic disease management AI (diabetes, hypertension, heart failure) that cannot detect when a patient is in a physiological state incompatible with the conversation being attempted, and cannot wait for genuine recovery before resuming high-demand interactions.
- Mental health companion systems that apply instantaneous stress thresholds, missing the path-dependent nature of anxiety and trauma re-entry.
- Clinical care coordination systems where a physiological event at the patient level is invisible to agents operating at the organizational level (claims, compliance, scheduling) because there is no shared state -- only serialized API payloads.
- Pharmacist and adherence support AI that treats drug prescriptions as binary (prescribed / not prescribed) rather than as time-varying PK/PD trajectories that determine whether the patient's physiology is currently capable of the behavioral change being asked of them.

---

## 4i. Market Access

This invention is an extension of the first patent (A Distributed System for Corroborative Data Acquisition) and the second patent (A system to facilitate agreement when multiple individuals have conflicting interests and limited disclosure). The first two patents describe the hardware network topology, consent management, and care circle orchestration. This invention describes the mathematical reasoning engine that operates within that architecture.

The target deployment context is Quality Improvement (QI) programs in hospital Revenue Cycle Management, patient adherence programs for high-cost therapy, and mental health companion applications requiring medical-grade safety guarantees.

The Behavioral Health market is estimated at  billion (Precedence Research, Oct 2025). Healthcare AI is projected to reach .95 billion by 2030 (Grand View Research).

---

## 4j. Future Developments

1. **Full Partial Trace Implementation:** The current implementation uses a transfer-matrix approximation for partial trace operations (restricts MPS contraction to the first chi_semantic bond indices). The exact partial trace - forming the full density matrix rho = |Psi><Psi| via double-layer contraction - is planned as Phase 4b. This will enable principled inter-agent subspace sandboxing, information-theoretic reward shaping, and semantic retrieval keys for TensorRAG.
2. **ALS Policy Integration:** The current A3C policy update uses log-bias Exponentially Weighted Moving Average (EWA). Wiring ALS into the A3C policy update requires representing the actor policy as an MPS and calling als_sweep() as the gradient step. This is planned future work.
3. **Bipartite Tensorized LLM Decoder:** The complete bipartite architecture (Multilinear Logic Engine + Tensorized Transformer for long-form generation) is a planned extension. The current system invokes the primary inference model via a cloud API without tensor-level output manipulation.
4. **Inertial V_int Extension:** V_int currently uses fixed priors. The planned inertial extension (alliance persistence across sessions) would allow social coupling strengths to decay and rebuild based on conversational history, encoding therapeutic alliance formation and caregiver burnout into the tensor geometry itself.
5. **SOP Update Pipeline via Live ALS Injection:** Mapping out how to inject new contrastive SVD matrices into the live tensor network using ALS without taking the system offline is a planned operational workflow for hospital SOP change management.

---

## 4k. Applications

1. **Prior Authorization and Claims in Hospitals:** A hospital-side Claims Agent and a TPA-side Compliance Agent coordinate on a shared inter-orgnet tensor manifold. The Claims Agent reads the patient's physiological state via partial trace before initiating a prior authorization appeal, timing the request to the patient's lowest-stress window. Contrastive Subspace Distillation resolves contradictions between the hospital billing SOP and the TPA's step-therapy policy, compiling the exact topological boundary between approved and denied pathways directly into the tensor geometry.
2. **Patient Adherence Programs:** Multi-agent care circle coordination where Clinical, Caregiver, and Administrative agents share physiological state without text serialization. Particularly for high-cost therapies (SSRI initiation, beta-blocker titration) where PK/PD mismatch causes premature treatment abandonment.
3. **Mental Health Companion Applications:** Exposure therapy (flooding) and de-escalation therapy require precise control over the patient's physiological trajectory over a multi-turn horizon. The PhysioInertiaGate and POMDP-I formulation provide the required control.
4. **Insurance Prior Authorization and Appeals:** The Social Coupling Matrix V_int tracks TPA adjudication friction, caregiver advocacy capacity, and clinical urgency simultaneously. Contrastive Subspace Distillation compiles the exact topological boundary where caregiver advocacy + clinician urgency legally overrides TPA cost barriers.
5. **Edge-Deployable Medical-Grade AI:** The O(1) memory footprint of the MPS (bounded by [chi x d x chi] core tensors, no KV cache) enables deployment on standard hospital hardware without centralized GPU clusters, preserving data sovereignty.

---

## APPENDIX A: Mathematical Glossary


| Symbol     | Meaning                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| MPS /      | Psi_t>                                                                                                                               |
| chi        | Bond dimension: maximum rank of the virtual bond connecting adjacent tensor cores; caps the number of parallel mathematical channels |
| A(t)       | Local core tensor at conversational step t; dimensions [chi x d x chi]                                                               |
| d          | Physical index dimension (vocabulary size, approximately 50,000 tokens)                                                              |
| H_eff      | Effective Hamiltonian governing conversation physics: H0 - i*Gamma                                                                   |
| H0         | Hermitian semantic flow component of H_eff                                                                                           |
| Gamma      | Anti-Hermitian dissipation matrix encoding six physiological decay channels                                                          |
| H          | Transition operator: exp(-i * H_eff * delta_t)                                                                                       |
| s          | Weighted stress index: s = w1*sigma_HRV + w2*sigma_EDA + w3*sigma_sleep + w4*sigma_glucose + w5*sigma_reactivity                     |
| lambda_1   | Second eigenvalue of physiological transfer matrix; patient's autonomic decay constant gamma maps to                                 |
| V_int      | Social coupling matrix (n x n); encodes coupling strength between care circle principals                                             |
| rho_clin   | Reduced density matrix of Clinical Agent obtained by tracing out physiological subspace: Tr_phys(                                    |
| rho_claims | Reduced density matrix of Claims Agent obtained by tracing out Compliance Agent subspace: Tr_compliance(                             |
| Mtrunc     | Truncated bond matrix obtained from SVD of the MCTS optimal path; injected as [MCTS GUIDANCE] into tactical agent system prompt      |
| A_delta    | Contrastive activation delta: A_compliant - A_fatal; input to Orthogonal SVD                                                         |
| ke0        | Pharmacokinetic equilibration rate constant for blood-to-receptor drug transfer                                                      |
| HPVOOT     | Hierarchical Progressive Widening + Variable-Order Option Trees MCTS variant                                                         |


---

## APPENDIX B: Physiological Inertia in a Live Clinical Conversation -- Full Worked Example

This appendix walks through a single patient interaction turn by turn to show how the implemented system -- the PhysioInertiaGate, the shared tensor state buffer, the PKPD model, and the MCTS guidance bridge -- operate together in a real conversation.

### The Patient and Clinical State at Turn 1

**Patient:** 58-year-old with hypertension. Prescribed propranolol (beta-blocker) 48 hours ago. Appointment with companion AI to discuss adherence and whether to increase the dose.

**Biometric readings at session start:**
- RMSSD (HRV): 18 ms (low; clinical normal is 40+ ms for this age group)
- EDA: 0.7 (elevated skin conductance; 0 = baseline, 1 = maximum stress)
- Sleep index: 0.4 (two nights of disrupted sleep reported)
- Glucose: 0.3 (within range, low weight)

**Step 1 -- Computing the stress index s:**

    s = 0.35 * sigma_HRV + 0.25 * sigma_EDA + 0.20 * sigma_sleep + 0.10 * sigma_glucose + 0.10 * sigma_reactivity
    s = 0.35 * 0.78 + 0.25 * 0.70 + 0.20 * 0.60 + 0.10 * 0.30 + 0.10 * 0.40
    s = 0.273 + 0.175 + 0.120 + 0.030 + 0.040 = 0.638

**PhysioInertiaGate zone:** 0.638 falls in Zone 3 (elevated, threshold 0.60-0.78). The patient entered Zone 3 last session as well, so this is not a first crossing -- the Schmitt-trigger history flag is set.

**Step 2 -- Computing the autonomic decay constant gamma:**

    gamma = RMSSD_normalised / (EDA_modifier * sleep_modifier)
    gamma = 0.22 / (1.42 * 1.31) = 0.118 /turn

The corresponding eigenvalue of the physiological transfer matrix:

    |lambda_1| = exp(-0.118 * 1.0) = 0.889

This means after each conversational turn, approximately 89% of the current stress amplitude persists into the next turn. A patient with a healthy HRV of 50 ms and no EDA elevation would produce gamma ~= 0.41, giving |lambda_1| ~= 0.66 -- stress dissipates much faster.

**Step 3 -- PKPD: propranolol biophase status:**

Propranolol was prescribed 48 hours ago. The ke0 biophase equilibration rate is 0.20 /min. At 48 hours post-dose with standard oral dosing, the steady-state plasma concentration is established, but the sympatholytic effect lags the plasma level by the ke0 kinetics. The PKPD model computes:

    E(t) = Emax * C_effect^n / (EC50^n + C_effect^n)
    E(t) = 0.72  (partial effect; not yet at full therapeutic ceiling)

This means Gamma_pkpd contributes only 72% of its maximum possible dissipation contribution. The drug is working, but not fully. An agent that assumed the beta-blocker was fully active would overestimate how quickly this patient's stress can be expected to fall.

### The Action the Clinical Agent Wants to Take

The Clinical Agent's prior on the most medically appropriate next move, based on the patient's adherence history and clinical protocol, is: **escalate_dose** (propose increasing propranolol to the next titration step). This is a high-demand action -- it requires the patient to process new dosing instructions, adjust their schedule, and accept a change to a regimen they are still getting used to.

In Zone 3, escalate_dose is in the suppressed action set. The PhysioInertiaGate blocks it from being included in the MCTS search space for this turn.

### What the System Does Instead

The MCTS runs 80 iterations over the available Zone 3 action set. The de_escalate cluster receives q_bias = +0.25 at initialization. The cost function minimizes accumulated Gamma over the 5-turn horizon. The top-3 actions from the truncated bond matrix Mtrunc are:

1. validate_experience ("It sounds like adjusting to a new medication while managing everything else has been a lot.")
2. psychoeducation_physio ("Many people find the first few weeks of a beta-blocker adjustment feel different -- your body is recalibrating.")
3. open_question_barriers ("What has been the hardest part of the new routine so far?")

These are injected as [MCTS GUIDANCE] into the Clinical Agent's system prompt. The Clinical Agent generates the response within this subspace. escalate_dose is not in the prompt. The agent does not need a rule saying "do not escalate when stressed." It simply does not have the option available to generate.

### Turns 2-3: Stress Trajectory and Gate Transition

After two validate/psychoeducation turns, the patient's vocal tone and reported experience are re-evaluated by the stress model. New RMSSD reading: 24 ms. New EDA: 0.52. Revised s = 0.541.

0.541 is below the Zone 3 entry threshold (0.60), but the PhysioInertiaGate requires the reading to remain below the **exit threshold** of 0.54 (= 0.60 - dead-band 0.06) for a sustained crossing before transitioning down. 0.541 is not below 0.54. The gate stays in Zone 3.

Turn 3 reading: s = 0.521. This is below 0.54. The Schmitt trigger registers a sustained crossing. Gate transitions to Zone 2 (moderate).

### Turn 4: Escalate_dose is Now Available

In Zone 2, escalate_dose is no longer suppressed. The MCTS now includes it in the search space. The cost function evaluates it over the 5-turn horizon: given the current |lambda_1| = 0.868 (stress still partially elevated) and partial PKPD effect (E(t) = 0.74), the MCTS projects that the patient can process the dose change conversation without physiological deterioration. It scores above the de-escalate cluster for the first time this session.

The Clinical Agent proposes the titration step. The patient agrees. The session closes with goal_progress = 0.81 (above the 0.75 success threshold).

### What an Instantaneous Threshold System Would Have Done

A system using a simple `if stress > 0.60: suppress_escalation` rule would have escalated in Turn 3 the moment s dropped below 0.60 (to 0.541), without waiting for a sustained crossing. The patient would have received the dose escalation proposal while still in a physiologically fragile state -- stress at 0.541, |lambda_1| = 0.876, with the beta-blocker still below full effect. The probability of the patient accepting and adhering to the new dosing instruction in this state is substantially lower. The Schmitt trigger's dead-band exists precisely to prevent this: it costs one additional validation turn in exchange for a genuine physiological recovery window.

---

## APPENDIX C: MCTS Action Taxonomy

This disclosure uses 22 stress-gated actions drawn from a full vocabulary of 51 entries. The 47 distinct actions (pre-stress-gating) are organized into six clusters for Hierarchical PW+VOOT search:


| Cluster     | Size | Typical PhysioInertiaGate Zone     |
| ----------- | ---- | ---------------------------------- |
| de_escalate | 10   | Zones 3-4 (elevated, critical)     |
| explore     | 8    | Zone 0 (calm)                      |
| challenge   | 7    | Zones 1-2 (mild tension, moderate) |
| inform      | 6    | Zones 1-2                          |
| structure   | 11   | Any zone                           |
| meta        | 5    | Zones 3-4 (safety / terminal)      |


Zone-seeded cluster priors inject additive bias q_bias into cluster prior at search initialization:

- q_bias(de_escalate, zone=4) = +0.40
- q_bias(de_escalate, zone=3) = +0.25
- q_bias(explore, zone=0) = +0.20
- q_bias(challenge, zone=1) = +0.15

VOOT variance bonus penalises clusters with high reward variance, preventing premature commitment to a single therapeutic style in the first 30-50 iterations.

Progressive Widening (PW) within each cluster: a new action is admitted only when visits > 2 * sqrt(visits_so_far). Risky actions (flooding_deepen, escalate) are placed last in the queue, unlocking only after the cluster has been well-explored.



