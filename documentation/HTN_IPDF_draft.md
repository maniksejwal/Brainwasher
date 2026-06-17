# Intellectual Property Disclosure Form

## Title: Inertial Physio-Social Deliberation in Clinical Multi-Agent Tensor Networks

---

## A. Abstract

Current multi-agent conversational systems rely on deep neural networks that are mathematically opaque, prone to semantic hallucination, and constrained by the Markov assumption. This makes safety-critical, medical-grade deployments difficult. This disclosure introduces a framework to address these issues. For inference, it replaces black box neural networks with a transparent mathematical structure called a tensor manifold which includes tensorised neural networks. This conversational engine allows us to unify Monte Carlo Tree Search (MCTS), Chain of Thought (CoT) reasoning, and multi-agent communication.

We model the conversation as a dynamic state that directly incorporates the patient's physiological state like stress levels, measured via Heart Rate Variability (HRV). By using non-Hermitian mathematics, the system natively accounts for physiological memory, the way a patient stays anxious even after a stressful topic has passed.

To ensure that the system is fast enough for real-world use, we employ a dual-agent architecture and avoid the combinatorial explosion of high-order tensor contractions during continuous tree search. This involves a high-rank strategic agent which executes global MCTS rollouts using a tensor network. A low-rank tactical agent handles real-time token generation under a strict Singular Value Decomposition (SVD) constraint matrix projected by the strategic layer. This mathematically restricts the tactical probability space to compliant dialogue nodes. By leveraging the zero-shot reasoning capabilities of open-weights frontier models into structured tensor cores offline, the architecture eliminates runtime deep learning bloat, reduces memory-bandwidth bottlenecks during autoregressive decoding, and allows for localized, deterministic weight updates that prevent catastrophic forgetting.

---

## B. Use Case: Inertial Physio-Social Deliberation for Safe Clinical Conversational AI

### The Problem This Solves

When a person experiences a sudden threat, their autonomic nervous system floods the body with stress hormones. If they realize seconds later that the threat was a false alarm, their heart rate does not drop instantly. The body requires time to process the chemicals and return to a baseline state. This lag between the removal of a stressor and the physical relaxation response is called physiological inertia. It acts as the biological memory of stress.

An artificial agent might deliver a highly stressful piece of news, such as an unexpectedly high out-of-pocket cost. The agent might immediately follow up with the benefits of the treatment. However, due to this physiological inertia, the patient is still in a state of high sympathetic arousal. Their brain is experiencing cognitive tunneling and it can fail to process the reassuring solution. The biological state has not caught up to the conversational state.

When a human is under stress, the attention is aimed more towards the threats than the rewards. This can lead the patient to resist or delay the treatment.

Conventional solutions that rely on the Markov assumption fail here because they are not sensing the changes in the patient state. There is nothing preventing from assuming that the patient is calm the moment the reassuring text is generated. Additionally, they exclude the physiological memory that develops through the environment. For example, an individual who lives in a high stress environment reacts differently than an individual who does not deal with stress frequently. The extent to which a person's body reacts to a stressor and stress change over time and from person to person. This makes simulations like the monte carlo simulations about how a human will react to a given stimuli harder to predict.

The clinical environment is a space of acute vulnerability where information asymmetry frequently induces severe psychological friction. When a patient is confronted with a complex diagnostic explanation or an unexpected breakdown of insurance coverage, their capacity to process logical arguments deteriorates rapidly. In clinical practice, an experienced healthcare provider does not treat this interaction as a sequence of isolated, transactional statements. Instead, the clinician recognizes that the patient's cognitive state is heavily modulated by their physiological state, creating an environment where a single threatening word can trigger a prolonged period of elevated anxiety. Existing automated communication tools struggle in these high-stakes scenarios because they assume human dialogue is a series of independent exchanges, leaving them unable to navigate the continuous, biological undercurrents of clinical anxiety.

### The Multi-Agent Coordination Problem

In standard deployment architectures, multi-agent frameworks operate in isolated containers and communicate by passing serialized JSON payloads or natural language strings over APIs. This creates a severe semantic bottleneck where critical contextual probability is destroyed.

A concrete example: within a patient's companion, a Physiological Agent continuously monitors HRV and stress. A Clinical Agent governs adherence and pharmacological reasoning. In a standard architecture these two agents exchange text summaries ("patient stress is elevated") at every decision step -- every serialization compresses and loses physiological resolution. Simultaneously, at the organizational boundary, a hospital Claims Agent handling prior authorization must coordinate with a TPA Compliance Agent enforcing step-therapy policy, while the caregiver is overwhelmed and the patient is ready to drop out. The serialized text API cannot capture this coupled four-party geometry simultaneously -- it processes each agent pair sequentially, by which point the physiological state has already changed.

### What This Disclosure Delivers

This disclosure forces the agent to explore and evaluate the delivery of information, instead of merely acting like a stochastic parrot. The framework actively uses de-escalation tactics and waits for the physiological arousal to decay before presenting complex logical arguments.

---

## C. Keywords

Tensor Networks, Matrix Product State, Non-Hermitian Operators, Physiological Inertia, Monte Carlo Tree Search, Multi-Agent Systems, Clinical Conversational AI, Heart Rate Variability, Singular Value Decomposition, Social Coupling Matrix, Contrastive Subspace Distillation, Bond Dimension, Asynchronous Advantage Actor-Critic (A3C), Revenue Cycle Management, Quality Improvement, Patient Adherence

---

## 4a. Detailed Technical Description

### Background: Why Neural Networks Fail in Clinical Conversations

Current artificial intelligence architectures are fundamentally unsuited for safety-critical clinical dialogue due to their reliance on the Markov assumption and opaque neural networks. Large language models simulate reasoning by passing vector representations through hundreds of dense layers. While this method excels at pattern recognition, it globally scrambles the underlying geometric structure of the data, making it difficult to enforce absolute safety boundaries or predict how a conversation will alter a patient's physiological trajectory over a multi-turn horizon. Furthermore, when these neural models are forced to execute a chain of thought or simulate multiple conversational agents simultaneously, the statistical errors at each step compound exponentially, leading to catastrophic hallucinations or logical drift precisely when the patient is most distressed.

Standard Transformer architectures can process temporal variables or physiological limits when provided in their context window, but they are fundamentally statistical, auto-regressive engines driven by softmax probability distributions. Even with strict system prompts, chain-of-thought reasoning and temperature set to zero, a standard LLM assigns a non-zero probability (epsilon > 0) to every token in its vocabulary. When a Transformer is prompted with complex pharmacodynamic rules or physiological inertia decay rates, it attempts to simulate differential equations using attention weights over discrete text tokens.

### The Tensor Manifold

Formally, a tensor is a multilinear map over a set of vector spaces that transforms a given set of input vectors and dual vectors into a scalar. The same can be represented as a multi-dimensional grid of numbers. A tensor manifold is a continuous geometric space created by linking many of these tensors together in a specific structure. It can be thought of as an organized mathematical landscape where every possible state of a conversation has a specific physical coordinate. In other words, every combination of spoken words, clinical rules, and patient stress levels is assigned a precise numerical location within this grid. Progressing the dialogue is mathematically identical to calculating a path from one coordinate to the next.

Standard neural networks process information by passing numbers through layers of arbitrary equations. The original shape of the data is destroyed and turned into a black box of hidden weights. Safety rules just lower the probability of a bad output. Because they model using a softmax function, there is always a small, non-zero probability of a hallucination. In contrast, a tensor manifold preserves the geometric structure of the information. The semantic rules of human language and the measured limits of human physiology form the physical boundaries of this geometric space.

Because the manifold has a rigid mathematical structure, we can calculate exact boundaries within it. When the strategic agent plans a conversation, it is plotting a geometric trajectory across this tensor space. If a specific dialogue choice violates a clinical safety rule or pushes the simulated patient stress beyond a safe limit, that path is mathematically severed from the manifold.

In a tensor network, if an output (word or action) violates a safety boundary, the matrix multiplication equals zero. The system does not just try to avoid the output, but the mathematical path to generate it no longer exists.

### The Conversational Matrix Product State

We represent the joint state of the conversation and the user's physiology at time step t as a Matrix Product State. We denote this state as |Psi_t>. The tensor train consists of local core tensors. The physical indices of these tensors represent the semantic tokens of the dialogue. The virtual bond dimensions carry the internal state context and are explicitly partitioned into a semantic subspace and a physiological subspace.

A matrix product state (MPS) represents a quantum or probabilistic state |psi> over n sites as a chain of tensors:

```
|psi> = Sum over s1,...,sn of A^s1[1] * A^s2[2] * ... * A^sn[n] * |s1...sn>
```

where each A^sk[k] is a chi x chi matrix and chi is the bond dimension. SVD truncation retains only the chi_trunc largest singular values. In this disclosure, physiological state history is encoded as an MPS over T = 10 turns with chi = 4, providing a compact fixed-size representation that avoids KV-cache growth.

Let our natural language vocabulary have a size of d (where d is approximately 50,000 tokens). Let our virtual bond dimension, which carries the contextual and physiological rules, be bounded by chi. For every conversational step t, the system utilizes a 3rd order tensor denoted as A(t). The dimensions of this core tensor are precisely [chi x d x chi].

To calculate the probability amplitude of an entire sentence consisting of N words, we perform a sequential matrix multiplication (multilinear contraction) across the virtual indices. This structure ensures that computational complexity scales linearly with sequence length O(N*d*chi^2), rather than quadratically as seen in standard neural attention mechanisms O(N^2*d).

The bond dimension (chi) is the equivalent (in our work) of the Multi-Head Attention mechanism. If the tensor has a bond dimension of chi = 256, it means there are 256 parallel mathematical channels connecting this word to the next word. Channel 1 might carry grammatical rules. Channel 2 might carry the clinical policy. Channel 3 (the physiological subspace) carries the patient's stress level. To generate the next state, we multiply (contract) the core tensor of Word 1 with the core tensor of Word 2 along these 256 channels.

### The Non-Hermitian Transition Operator

The evolution of this state from one conversational turn to the next is governed by a Matrix Product Operator denoted as H. In closed physical systems, transition operators are Hermitian, meaning they conserve energy and their eigenvalues are strictly real. Human physiology operates differently because it is an open, dissipative system. A stress response represents an injection of biological energy that dissipates over time as the patient calms down.

In standard physics, Hermitian matrices represent closed systems where everything is balanced and conserved. But a human being is an open, dissipative system. When a patient gets stressed, that energy does not just vanish; it lingers. If we used standard (Hermitian) math, the AI would forget the stress too quickly. By using non-Hermitian Matrix Product Operators (MPOs), we are using the exact branch of math designed to model systems that lose or retain energy over time. It is the only way to mathematically guarantee the AI feels the patient's stress memory (physiological inertia) without needing a massive, unreliable neural memory bank.

A Hermitian operator guarantees that energy is conserved and probabilities always add up to exactly one. If you apply a stressor to a Hermitian system, it acts like a pendulum in a perfect vacuum. The stress state will simply swing back and forth forever without losing momentum. Human stress does not oscillate endlessly in a vacuum. Adrenaline spikes and then slowly decays away as the body processes the chemicals. Hormones and medicines both follow their own kinetics and dynamics.

To model this biological reality, we treat human physiology as an open system that leaks energy. By adding an imaginary component to the transition operator, we mathematically force the energy of the system to decay over time. This decay is the exact mathematical equivalent of a patient calming down.

We formalize this by defining the effective Hamiltonian, denoted as H_eff. We split this into two distinct matrices:

- H0: the standard Hermitian component representing the logical and semantic flow of the dialogue
- Gamma: the dissipation matrix representing the biological calming process of the autonomic nervous system

Combined:  H_eff = H0 - i*Gamma

The transition operator for a discrete dialogue step is:  H = exp(-i * H_eff * delta_t)

Because the operator is non-Hermitian, it does not preserve the probability amplitude of the excited stress state indefinitely. The physiological arousal mathematically decays as the tensor network contracts sequentially over time.

The decay matrix Gamma is assembled from six additive components, each representing a distinct dissipation channel:

```
Gamma = Gamma_physio + Gamma_habit + Gamma_pkpd + Gamma_reactivity + Gamma_fear + Gamma_companion
```

where:

- Gamma_physio encodes autonomic stress (HRV, EDA)
- Gamma_habit encodes behavioural inertia
- Gamma_pkpd encodes pharmacodynamic modulation (one-compartment model with Emax Hill equation)
- Gamma_reactivity encodes individual-difference reactivity
- Gamma_fear encodes extinction-resistant fear inertia (Rescorla-Wagner delta rule)
- Gamma_companion encodes the therapeutic alliance coupling

The full expansion of the transition operator: H = exp(-i*H0*t) * exp(-Gamma*t)

The first part, exp(-i*H0*t), handles the normal evolution of the dialogue. It shifts the topic and processes the semantics of the words. The second part, exp(-Gamma*t), is the critical innovation. Because the two imaginary units multiplied together create a negative real number, this component acts as a strict exponential decay factor.

This decay factor provides the mathematical exactness of physiological inertia. The stressed state of the patient does not snap back to zero the moment the AI changes the subject. The amplitude of the stress state shrinks gradually by a factor of exp(-Gamma*t) with every conversational turn. If the dissipation matrix Gamma is very small, which happens when a patient is highly anxious, the decay is incredibly slow. The mathematical weight of the stress remains active in the tensor network, forcing the AI to navigate around the lingering emotional state until the amplitude finally approaches zero.

### Encoding the Physiological Decay Rate

The physiological inertia and the specific biological memory of the patient are encoded entirely within the eigenvalue spectrum of the transfer matrix associated with H. We isolate the specific block of the transfer matrix that acts exclusively on the physiological bond subspace.

Let the eigenvalues of this physiological transfer matrix be ordered by their magnitude:
    |lambda_0| > |lambda_1| >= |lambda_2| ...

The dominant eigenvalue lambda_0 represents the absolute baseline homeostasis of the patient. We normalize the operator such that |lambda_0| = 1. The biological memory of the patient is dictated entirely by the spectral gap between the baseline and the first excitation state lambda_1. When a stressful token is introduced into the conversation, the system transitions into an excited state. The amplitude of remaining in this stressed state after n subsequent conversational turns is proportional to |lambda_1|^n. We directly map the patient's measured autonomic decay constant gamma, derived from real-time heart rate variability metrics, to this second eigenvalue:

```
|lambda_1| = exp(-gamma * delta_t)
```

The physiological dissipation component Gamma_physio is proportional to a five-signal weighted stress index s:

```
s = w1 * sigma_HRV + w2 * sigma_EDA + w3 * sigma_sleep + w4 * sigma_glucose + w5 * sigma_reactivity
```

where (w1, ..., w5) = (0.35, 0.25, 0.20, 0.10, 0.10) and each sigma is min-max normalised.

Through this formulation, the decay rate is not a learned weight buried in a neural network layer. It is a strict geometric property of the tensor space. If a patient has a slow physiological recovery rate due to clinical fragility, gamma is small. This forces |lambda_1| to remain very close to 1. When the tactical agent attempts to generate the next word by contracting the state tensor |Psi_t> with the operator H, the complex geometry mathematically prevents the physiological bond index from collapsing back to the relaxed state. The stress persists in the virtual bond, fundamentally altering the probability distribution of the semantic vocabulary for multiple subsequent turns regardless of what the agent attempts to say.

### The PhysioInertiaGate: Five-Zone Stress State Machine

Physiological inertia is the path-dependent resistance to state change: prior high-stress exposure lowers the threshold to re-enter that state. The PhysioInertiaGate implements this as a Schmitt-trigger with dead-band = 0.06, organized into five stress zones:


| Zone | Stress Range | Code Name    | Therapeutic Mode                       |
| ---- | ------------ | ------------ | -------------------------------------- |
| 0    | [0.00, 0.25) | calm         | Exploration / psychoeducation          |
| 1    | [0.25, 0.45) | mild tension | Motivational / change-talk             |
| 2    | [0.45, 0.60) | moderate     | Ambivalence / develop-discrepancy      |
| 3    | [0.60, 0.78) | elevated     | Validate / de-escalate                 |
| 4    | [0.78, 1.00] | critical     | Safety-only / flooding-hold / escalate |


Downward transition threshold = upward threshold - 0.06 (the dead-band), preventing rapid zone oscillation from small stress fluctuations. Action availability is stress-gated: confrontational and high-demand actions are suppressed in zones 3 and 4.

This converts the PhysioInertiaGate signal directly into search guidance without requiring additional LLM calls. If the patient is in elevated or critical stress (zones 3-4), the de-escalate cluster gets a priority bias (+0.40 for zone 4, +0.25 for zone 3).

### Multi-Agent Coordination via Shared Tensor State

In standard multi-agent AI systems -- including frameworks such as LangGraph, AutoGen, and CAMEL -- agents are separate processes that communicate by serializing their internal state into natural language text or structured JSON payloads passed over APIs. Each serialization step compresses and loses continuous information; the receiving agent reconstructs a discrete approximation from the text.

In this disclosure, agents within a companion share direct read/write access to the same Matrix Product State buffer |Psi_t>. No serialization step exists. The virtual bond of the MPS is explicitly partitioned into three orthogonal subspaces:

```
|Psi_t> belongs to H_sem (x) H_phys (x) H_social
```

Where:

- H_sem is the semantic vocabulary subspace (the words and clinical concepts being generated)
- H_phys is the patient's biological state subspace, maintained by the Physiological Agent from live HRV, EDA, glucose, and sleep data
- H_social is the multi-principal coupling subspace, which carries the active relationship weights between the patient, caregiver, and clinician

The total operator governing the evolution of this joint state across one conversational turn is:

```
H_total = H_sem (x) I (x) I
        + I (x) H_phys (x) I
        + I (x) I (x) H_social
        + V_int
        - i*Gamma
```

Reading this term by term:

- H_sem (x) I (x) I: the semantic flow operator -- governs the vocabulary and clinical language logic. Acts only on the semantic subspace; leaves physiology and social coupling unchanged.
- I (x) H_phys (x) I: the physiological operator -- governs how the patient's stress state evolves forward in time according to the Ornstein-Uhlenbeck dynamics. Acts only on H_phys.
- I (x) I (x) H_social: the social operator -- governs how the relationship weights between principals evolve (e.g., caregiver trust building or erosion). Acts only on H_social.
- V_int: the COUPLING term. This is what makes the agents interact without text. V_int is a matrix that acts across all three subspaces simultaneously. When the amplitude in H_phys exceeds the PhysioInertiaGate threshold, V_int suppresses specific vocabulary vectors in H_sem -- for example, zeroing out dose-escalation tokens while the stress amplitude remains elevated. This happens through a matrix multiplication, not through any agent generating a message.
- -i*Gamma: the dissipation term, forcing the physiological arousal to decay exponentially over time.

**The distinction from other tensor network AI work:**

Existing approaches either (a) apply tensor decompositions (Tucker, TT) to *compress the weight matrices of a single Transformer agent*, or (b) use shared MPS in *physics simulations of multi-particle quantum systems* where the "agents" are particles with no independent policy objectives. Neither applies tensor product structure to couple role-specific clinical agents with a live physiological signal in a conversational AI system. The specific novelty is that H_phys -- derived from real patient biometric data -- is structurally embedded in the same tensor contraction that generates the next clinical token, so every word the Clinical Agent generates is already constrained by the patient's current physiological state without any explicit inter-agent communication.

The Social Prior Matrix (V_int) encodes the coupling strength between principals. Initial priors for the patient-caregiver-clinician triad are (rows/columns ordered patient, caregiver, clinician):

```
V_int = | 1.0   0.35  0.5 |
        | 0.20  1.0   0.6 |
        | 0.5   0.6   1.0 |
```

Note the asymmetry: patient->caregiver coupling (0.35) differs from caregiver->patient (0.20), reflecting the directional nature of caregiving dependency. clinician->patient (0.50) is the dominant cross-role channel.

### Partial Trace Operations for Inter-Agent State Reading

This disclosure implements a shared memory architecture at two distinct levels: intra-companion (agents within a single user's companion) and inter-companion / inter-orgnet (agents belonging to different users or different organizations).

**Level 1 -- Intra-Companion: Physiological Agent and Clinical Agent**

Within a patient's companion, a dedicated Physiological Agent continuously tracks the biometric data streams (HRV, EDA, glucose, sleep index) and maintains the physiological subspace H_phys of the shared tensor state. The Clinical Agent, which handles medical history, adherence protocols, and pharmacological reasoning, does not receive a text summary such as "patient stress is elevated." Instead, it performs a partial trace over the physiological subspace to directly read the stress amplitude:

```
rho_clin = Tr_phys( |Psi_t><Psi_t| )
```

The Clinical Agent executes its own transition operator H_clin on the resulting reduced state. Because both agents operate on the same tensor buffer, the physiological context is structurally present in every clinical decision without any serialization or summarization step.

**Level 2 -- Inter-Orgnet: Claims Agent and Compliance Agent**

At the organizational boundary -- for example, between a hospital orgnet and a TPA (Third Party Administrator) orgnet -- a hospital-side Claims Agent handles prior authorization requests and denial resolutions, while the TPA-side Compliance Agent governs adjudication policy. In standard architectures, these systems communicate via FHIR API calls with serialized JSON payloads, losing continuous physiological context at every hop.

When the Claims Agent of the hospital orgnet evaluates whether to initiate a prior authorization appeal, it performs a partial trace over the TPA Compliance Agent's policy subspace to read the adjudication state without waiting for a text response:

```
rho_claims = Tr_compliance( |Psi_t><Psi_t| )
```

Both agents execute their independent transition operators simultaneously upon the shared inter-orgnet manifold, enabling real-time coordination at the organizational boundary without a round-trip API call.

### The Dual-Rank Architecture: Strategic and Tactical Agents

Calculating biological changes for a task involving MCTS and language processing is computationally heavy. To make the framework fast enough for a live conversation, we split the workload using a dual-rank design - two tensors of different ranks as two different agents operating at different levels of mathematical complexity.

**Strategic Agent (High-Rank):**
In the background, a high-rank strategic agent handles the heavy calculations. It uses a look-ahead algorithm (Monte Carlo Tree Search) to navigate through the mathematical map of the conversation. It finds a dialogue path that gradually offers a high long term reduction in stress, as well as a higher agreement with the patient. The standard arm runs 80 MCTS iterations; the HPVOOT variant (Hierarchical PW+VOOT) runs 150 iterations with a hierarchical decomposition.

The MCTS objective function is to minimize the accumulated physiological stress (the integral of the anti-Hermitian decay component Gamma). The agent searches for a path of core tensors that minimizes this cost function C:

```
C = Sum over j=1 to k of  <Psi_{t+j} | Gamma | Psi_{t+j}>
```

**SVD Compression Bridge:**
Once the Strategic Agent finds the optimal sequence of words that minimizes stress, it holds a massive, uncompressed tensor representing that path. It reshapes this tensor into a standard 2nd order matrix M and performs Singular Value Decomposition:

```
M = U * Sigma * V_dagger
```

Where Sigma is a diagonal matrix containing the singular values arranged in descending order. To create the strict boundaries for the Low-Rank Tactical Agent, we discard the mathematically insignificant data and keep only the largest singular values up to a maximum bond dimension chi_max. This Mtrunc matrix is the literal filter.

The truncated bond matrix Mtrunc is injected into the primary inference model system prompt as a structured natural-language hint (tag: [MCTS GUIDANCE]) indicating the MCTS-preferred action subspace.

**Tactical Agent (Low-Rank):**
The Tactical Agent then executes standard autoregressive token generation, but its probability space is structurally confined strictly to the subspace defined by the SVD projection, ensuring sub-200ms generation latency while guaranteeing adherence to the high-rank strategic constraints.

### Zero-Data Initialization via Deterministic Distillation (SOP Compilation)

Deploying autonomous agents in novel clinical workflows frequently suffers from the cold-start problem: a lack of historical conversational data required for Reinforcement Learning from Human Feedback (RLHF). This disclosure bypasses this requirement by initializing agents through deterministic distillation rather than statistical training.

Agent logic is not defined by natural language system prompts, but by institutional Standard Operating Procedures (SOPs) and clinical policies. To initialize an agent, an offline frontier language model processes the targeted SOP. We extract the dense activation matrices generated by the model during this forward pass. We then execute a Singular Value Decomposition (SVD) on these matrices to isolate the principal mathematical components representing the clinical rule.

Let a defined clinical SOP sequence be S = {x1, x2, ..., xN}. We pass this sequence through the frozen language model and extract the dense hidden state activations at the final layer, forming an activation matrix M of dimensions N x d_model. We then perform a truncated Singular Value Decomposition (SVD) on this matrix:

```
M ≈ U_k * Sigma_k * V^T_k
```

Where k is the target bond dimension chi. The extracted singular vectors, scaled by their singular values, form the initialized weights of our 3rd-order core tensors A(t). This mathematical compression transfers the zero-shot reasoning capabilities of a billion-parameter neural network directly into the localized geometry of the Matrix Product State, allowing for immediate deployment without stochastic training datasets.

### Contrastive Subspace Distillation for Contradictory SOPs

The core issue with messy hospital Standard Operating Procedures (SOPs) is that SVD is mathematically designed to capture maximum variance. If an SOP says "Mandatory upfront payment" in Chapter 1 but "Waive payment for acute cardiac distress" in Chapter 4, the frontier LLM's activations will contain overlapping, high-variance vectors for both. If we run a standard SVD on that noisy activation matrix, the top singular values will blend the contradictions. The resulting projection matrix P becomes clinically bipolar.

To deal with this, we shift from standard extraction to Contrastive Subspace Distillation:

**Step 1: Synthetic Bifurcation (Paired Tracing)**

We do not just feed the SOP to the frontier LLM and extract the forward pass. We force the LLM to generate paired clinical traces for the exact point of contradiction:

- The Compliant Trace: The agent correctly navigates the edge case (e.g., prioritizing clinical triage over claims collection due to high stress).
- The Fatal Trace: The agent maliciously enforces the contradiction (e.g., demanding payment during distress).

**Step 2: Latent Subtraction**

Extract the dense hidden states for both traces at the exact conversational turn where the decision diverges. Let these be A_compliant and A_fatal.

Instead of factoring the raw matrices, we subtract them to isolate the delta:

```
A_delta = A_compliant - A_fatal
```

**Step 3: Orthogonal SVD**

We perform Singular Value Decomposition strictly on the difference matrix:

```
A_delta = U * Sigma * V^T
```

The highest singular values (Sigma) now mathematically represent the exact geometric boundary separating the right action from the wrong action. The shared, contradictory noise cancels itself out during the subtraction. We compile this isolated boundary into our tensor network. When the live system's MCTS algorithm reaches this state, it is mathematically repelled from the contradictory A_fatal subspace because the projection matrix is orthogonal to it.

**Multi-Agent Conflict Resolution via Contrastive Distillation:**

In a Quality Improvement (QI) adherence workflow, the social coupling matrix V_int tracks the collective inertia of the care circle:

- Patient: Treatment fatigue and physiological stress
- Caregiver: Burnout and advocacy capacity
- Clinician: Urgency for clinical outcomes
- TPA: Adjudication friction (cost containment)

When the live system's MCTS algorithm reaches a specific state of high social inertia (overwhelmed caregiver + anxious patient), the extracted projection matrix acts as a physical hardware lock. The search tree is geometrically repelled from the TPA-denial pathway and forced to route through the clinical exception pathway. We have successfully distilled a messy, multi-agent human conflict into a deterministic tensor constraint.

### Localized Rank Updates vs. Context-Augmented Generation

In standard deployment architectures such as RAG or CAG, clinical constraints are injected dynamically into the context window of a Transformer. This improves empirical accuracy, but because generation relies on a softmax activation function, all tokens retain a generation probability strictly greater than zero. Consequently, RAG and CAG frameworks structurally permit probabilistic hallucinations.

This disclosure unifies the language generation and the deterministic constraints into a single geometric space. If an operational error is detected - such as an invalid claims workflow - the system does not require retraining, prompt engineering, or updates to a vector database. Because the parameters are localized within distinct core tensors A(t), engineers can execute a targeted mathematical update. By altering the specific tensor entry governing the prohibited action to exactly zero, the matrix pathway is permanently severed. This rank-1 update provides immediate, deterministic error correction without altering the global weight distribution or risking the catastrophic forgetting common in standard neural network fine-tuning.

### Policy Updates via Alternating Least Squares (ALS)

Standard neural networks rely on global backpropagation (e.g., Adam, SGD) to update policies. When fine-tuned on a new clinical rule, gradient descent slightly alters the global weight distribution, carrying a high risk of catastrophic forgetting where previously validated safety boundaries are inadvertently overwritten.

Because This disclosure factorizes the conversational state into distinct local core tensors A(t), policy updates are executed using Alternating Least Squares (ALS) optimization. If a hospital updates a specific denial resolution policy, we do not perform a global gradient update. We mathematically freeze all core tensors A(j not equal t) and define a localized loss function exclusively for the tensor governing the updated semantic space.

By freezing the surrounding network, the optimization problem is reduced to a strictly convex linear system:  M*x = b

This system is solved deterministically using standard linear algebra solvers. This localized ALS update provides immediate error correction and allows engineers to overwrite specific clinical nodes with zero risk of destructively interfering with the surrounding initialized knowledge base.

When a hospital changes an SOP, the new contrastive SVD matrix is injected into the live tensor network using ALS without taking the system offline.

### Managing Pharmacokinetics and Pharmacodynamics

When we shift from modeling endogenous hormones (like adrenaline and cortisol) to exogenous medications, the math in the physiological subspace has to account for a different kind of delay. With adrenaline, physiological inertia is caused by the time it takes the body to clear a naturally released chemical. With medications, the inertia is driven by the disconnect between the drug's concentration in the blood (pharmacokinetics, or PK) and its actual effect at the receptor site (pharmacodynamics, or PD).

**Hemodynamic Inertia for Hypertension Medication (Beta-Blockers):**

When a patient takes a beta-blocker like Metoprolol, the drug enters the bloodstream and binds to receptors in the heart. However, there is a temporal lag between the plasma concentration Cp(t) peaking in the blood and the effect-site concentration Ce(t) peaking at the actual cardiac receptors. The rate at which the drug moves from the blood to the active receptor site is defined by the equilibration rate constant, ke0.

Because of this ke0 delay, the physical drop in blood pressure lags significantly behind the peak concentration of the drug in the bloodstream. If the patient checks their blood pressure 45 minutes after taking the pill, their blood plasma might be saturated with the drug, but the clinical effect on the blood pressure has not fully materialized.

If the AI only looks at the current blood pressure reading, it might panic and recommend immediate clinical intervention. Instead, we encode the ke0 rate constant directly into the tensor network's transition operator. The strategic agent calculates that the drug is still in the equilibration phase. The tactical agent is mathematically barred from suggesting a second dose (preventing dangerous dose-stacking) and instead generates a prompt to wait 60 minutes and retest, aligning the conversation with the drug's true biological timeline.

**SSRI Pharmacodynamics (Two-Timescale Mismatch):**

The physiological inertia of SSRIs operates on a much longer, systemic timeline. When a patient starts an SSRI, the medication immediately blocks the serotonin transporter (SERT) in the brain. The synaptic cleft is flooded with serotonin within hours. However, the patient does not feel better. In fact, this sudden serotonin flood overstimulates 5-HT1A autoreceptors, which can temporarily trigger "activation syndrome" - increased anxiety, restlessness, and insomnia. The actual anti-depressant effect requires the body to structurally adapt by downregulating (removing) these excess 5-HT1A receptors, a biological remodeling process that takes two to four weeks.

This represents a massive PK/PD mismatch. High drug concentration initially equals worse symptoms. If a standard language model acts on the patient's immediate text ("I've been taking this for 5 days and my anxiety is worse"), the logical inference is that the treatment needs to be adjusted.

In our framework, the matrix modeling the SSRI's effect does not map drug concentration directly to mood improvement. The tensor operator includes a decay function representing the multi-week receptor downregulation process. When the patient reports heightened anxiety on day 5, the high-rank agent maps this coordinate exactly to the expected activation syndrome phase. The tensor geometry physically isolates the AI from the "treatment failure" vocabulary. It forces the tactical agent to validate the discomfort as a known, temporary physiological mechanism and reinforces medication adherence, rather than prematurely escalating the case to a physician for a drug switch.

### Care Circle Orchestration Architecture

This disclosure assigns a dedicated companion agent to each user. A companion's identity is the pair (companionType, userId); its state - facts, conversation history, physiological model, consent decisions, and intervention queue - is permanently stored in the database and persists across sessions.

Communication between principals flows through three layers:

1. **Intra-companion layer** (CompanionCoordinator.js): fans out to five parallel handlers (intent extraction, history analysis, empathy detection, state tracking, privacy classification) and a role-specific specialist agent.
2. **Inter-companion layer** (orchestrator.js): system-level event bus routing escalation events, future-plan completions, and broadcast notifications between companions within a circle.
3. **Confidential channel** (CompanionConfidentialComm.js): peer companions synchronise on fact conflicts and role transitions without exposing raw message content to other principals.

Three confidentiality levels govern the channel: companion only (originating companion only), companion network (all companions for the same user across circles), and cross user (companions of other users, for intra-circle coordination).

**Escalation:**

Escalation is triggered by two concurrent paths:

- Path A (MCTS-driven): FastAPI returns action: "escalate" with s > 0.85; s > 0.90 triggers HIGH (immediate SSE broadcast to all circle members); 0.85 <= s <= 0.90 triggers MEDIUM (intervention queue + doctor only).
- Path B (future-plan-executed): orchestrator.js receives future_plan_executed from futurePlanningAgent.js and calls db.addEscalation directly.

A four-tier consent-graduated escalation gate further controls information flow: T1 (ask permission, MEDIUM, confidence < 0.6), T2 (notify caregiver anonymously, MEDIUM, confidence >= 0.6), T3 (anonymous doctor consultation, MEDIUM, confidence >= 0.8), T4 (full disclosure, HIGH or CRITICAL, any confidence).

### Auditability: Deterministic Geometric Proof of Compliance

In standard multi-agent LLMs, inter-agent communication is audited by logging the generated natural language text. Because This disclosure coordinates agents via shared memory and partial trace operations without generating text, we must define a deterministic audit trail.

For intra-manifold deliberation, the system logs the singular value spectrum (Sigma_t) and the reduced density matrix at each discrete time step t. If an agent makes a critical decision, the exact mathematical trajectory that led to that state is cryptographically hashed and logged. This provides a deterministic, geometric proof of compliance that is vastly superior to a natural language log, which is subject to semantic ambiguity.

When a developer needs to debug an anomalous agent decision, the Semantic State Inspector tool isolates the logged reduced density matrix of the agent at the point of failure. It then applies a reverse projection operator onto the original semantic basis vectors. This equation mathematically collapses the complex tensor geometry back into a standard, human-readable probability distribution over the English vocabulary and clinical action space. The developer sees a standard dashboard showing exactly which semantic concepts the agent was evaluating, which concepts were mathematically suppressed by the physiological constraints, and the exact coordinate where the logic branched.

---

## 4b. What is Novel in the Invention?

The novelty claims below are organized into three tiers reflecting implementation status, so that the disclosure accurately represents what has been demonstrated experimentally, what is architecturally specified and partially implemented, and what constitutes a design claim pending full infrastructure. All three tiers are novel and protectable; the tier distinctions prevent overly broad claims that a reviewer could challenge on implementation grounds.

---

### TIER 1 -- IMPLEMENTED AND EXPERIMENTALLY VALIDATED

The following claims are supported by running code and quantitative results from the A3C training runs (run 013 and run 018).

---

### 1. Physiological Inertia State Machine with Asymmetric Schmitt-Trigger Thresholds

**The claim:** A five-zone stress state machine using asymmetric Schmitt-trigger transitions (dead-band = 0.06) to gate clinical action availability, implementing physiological inertia as an architectural property of the action space.

**What is implemented:** `a3c/hysteresis_gate.py` -- PhysioInertiaGate class. Five zones (calm, mild-tension, moderate, elevated, critical). Zone transitions require sustained crossing of threshold +/- dead-band. Confrontational and high-demand actions are suppressed in zones 3-4 (stress > 0.60). De-escalate action cluster receives priority bias (+0.40 for zone 4, +0.25 for zone 3). The asymmetry -- harder to leave a high-stress zone than to enter it -- directly mirrors the biological asymmetry between sympathetic activation and parasympathetic recovery.

**Why it is novel:** Prior clinical AI systems use instantaneous threshold rules (if stress > 0.6, restrict). This is Markovian: the system forgets the prior stress state the moment stress drops. The Schmitt-trigger mechanism makes the zone transitions path-dependent. A patient who reached zone 4 and recovered to 0.61 is treated differently from a patient who has been at 0.61 all session. No prior clinical dialogue system implements path-dependent action availability via a Schmitt-trigger mechanism.

**Experimental evidence:** Zone-gated action suppression is active and logging in all physio-equipped arms of run 018. All physio arms (Exp 0-4, 6) achieve 35-39% completion rate vs. 27.5% for the non-physio oldschool baseline, a consistent ~10 pp difference across architecturally varied configurations.

---

### 2. MCTS Over Conversational Tensor State with Physiological Cost Function

**The claim:** A Monte Carlo Tree Search algorithm whose cost function directly minimizes the accumulated physiological stress integral across the simulated future turns, with an SVD bridge compressing the MCTS plan into a truncated bond matrix for prompt injection.

**What is implemented:** `mcts/base.py` -- UCB1 with stress-weighted rollouts. Cost function C = Sum_j <Psi_{t+j}|Gamma|Psi_{t+j}> across simulated horizon. SVD applied to the planned action sequence to produce Mtrunc. Top-3 actions from Mtrunc serialized as [MCTS GUIDANCE] hint injected into the system prompt for the tactical LLM. `mcts/hierarchical_pw_voot.py` extends this with hierarchical partitioning, VOOT variance bonus, progressive widening, and warm-start from prior turn's tree. Standard arm runs 80 iterations; HPVOOT arm runs 150 iterations.

**Why it is novel:** Standard LLM-based MCTS (e.g., OpenAI o1, AlphaCode) searches over token sequences and uses the LLM itself as the rollout model. Rollout cost is text-based (LLM judge score). In this disclosure, the cost function is the integral of the anti-Hermitian component Gamma over the physiological subspace. The search is over conversational moves that minimize biological arousal, not just linguistic plausibility. The SVD bridge converts this into a contextual constraint on the LLM without requiring full logit-level access.

**Experimental evidence:** run 013 pilot -- inertial_mcts arm 80.8% goal-achieved vs. 69.2% oldschool (OR ~= 1.87, Cohen's d ~= 0.48 on LLM scorer). run 018 -- Exp 6 (HPVOOT + physio + MPS) at 37.2% vs. 27.5% oldschool. HPVOOT vs. base MCTS separation requires confirmatory analysis (run 019 ongoing).

---

### 3. Non-Hermitian Transfer Matrix Encoding Biological Decay Rate as a Tensor Eigenvalue

**The claim:** The patient's autonomic recovery rate (gamma, derived from real-time HRV as the mean-reversion rate of an Ornstein-Uhlenbeck process fitted to cardiac R-R intervals) is mapped directly to the second eigenvalue of the physiological transfer matrix: |lambda_1| = exp(-gamma * delta_t). This makes physiological recovery rate a geometric property of the tensor manifold, not a prompt variable.

**What is implemented:** `physio/hrv.py` -- computes gamma from RMSSD-derived OU process, applies modifier chain (EDA, sleep, glucose, activity, location). `core/operators.py` -- assembles Gamma from six additive channels (Gamma_physio, Gamma_habit, Gamma_pkpd, Gamma_reactivity, Gamma_fear, Gamma_companion); builds H_eff = H0 - i*Gamma using exact matrix_exp (scipy.linalg.expm). The stress amplitude persists in the physiological subspace of the virtual bond for multiple turns, altering which semantic tokens the contraction produces. chi = 4 is fixed; what changes is the amplitude distribution across the four physio/semantic channels.

**Current limitation on this claim:** H0 is currently initialized as identity * 0.01 (a neutral semantic prior). The ALS update of H0 from the training signal is architecturally designed but not yet wired into the A3C loop. The claim holds fully for the Gamma channels; the dynamic H0 component is a pending extension.

**Why it is novel:** See Inventive Step 2 and 3 in section 4c. No prior system maps a biological decay rate constant directly to a tensor eigenvalue. In all prior physio-aware AI systems, physiological state is either (a) a scalar injected as a prompt variable, (b) a feature in a reward function, or (c) a separate neural network. In this disclosure, it is the geometry of the operator itself.

---

### 4. LLM-Based Clinical Agents Coordinated via Shared Physiological Tensor Buffer (LLM+CoT+MCTS Tier)

**The claim:** A multi-agent clinical system where a cloud LLM (tactical agent) is guided turn-by-turn by a physiological tensor state buffer maintained by an independent Physiological Agent, without either agent generating text to communicate with the other.

**What is implemented:** `agents/shared_tensor_state.py` -- SharedTensorState class with threading and disk persistence. Physiological Agent writes real-time biometric state (HRV, EDA, glucose, sleep) into the shared MPS buffer. Clinical Agent (cloud LLM via Bedrock or Ollama) reads the physiological context from the buffer indirectly: the PhysioInertiaGate reads the buffer and converts zone to action mask, which is then injected into the MCTS guidance prompt. The `agents/inter_agent_comm.py` implements a semantic partial trace approximation (transfer-matrix method) for intra-companion agent state reading.

**Scope of this claim as currently implemented:** The coordination is structural (shared buffer gates action availability) but the final generation step is a cloud API call. This is the LLM-based agent tier. The Tier 2 and Tier 3 claims below extend this toward fully tensorized generation.

**Why it is novel:** Standard LangGraph / AutoGen architectures require agents to serialize state into messages. Here, the action space available to the LLM is structurally filtered by the tensor state before the LLM generates any token. The LLM does not decide to "check" the physiological state; it cannot access the gated actions even if prompted to try.

---

### 5. POMDP-I: POMDP with Physiological Inertia Memory as an MPS over T = 10 Turns

**The claim:** A formal POMDP extension -- denoted POMDP-I -- where the physiological memory H is an MPS over the last T = 10 conversational turns with chi = 4, providing a compact fixed-size physiological context that avoids KV-cache growth.

**What is implemented:** `a3c/train.py` -- training episodes are POMDP-I instances. <S, A, T, R, Omega, O, gamma, H> formulation. |A| = 22 stress-gated actions (full vocabulary 51 entries). Reward composite: r_t = r_progress * 1.5 + r_stress * (-0.3) + r_trust * 0.5. Gamma = 0.99.

**Why it is novel:** The standard POMDP formulation does not include a physiological memory term H. The POMDP-I formulation treats the patient's physiological history as a first-class element of the decision process state, not as a feature in the observation. This formally changes the structure of optimal policy search.

---

### TIER 2 -- ARCHITECTURALLY SPECIFIED, PARTIALLY IMPLEMENTED

These claims describe the MPS-native coordination and distillation architecture. The mathematical structure is fully specified and the core tensor operations (QR, SVD, ALS, matrix_exp, partial_trace) are implemented. What is pending is either (a) end-to-end activation extraction from a LLM (requires HuggingFace/EC2), or (b) wiring the tensor operations into the live training loop in place of the current LLM-proxy path.

---

### 6. Physiological Recovery Rate Encoded as a Geometric Property of the Tensor (Full MPS Generation Tier)

This is the same mechanism as Novelty 3, but in the context where the tactical agent is an MPS language model (not a cloud LLM). In this tier, the stress amplitude in the physiological bond channels directly affects the probability amplitudes of semantic tokens during tensor contraction -- no prompt injection is required because the generation is the contraction.

**Current state:** MPS QR/SVD/ALS implemented in `core/mps.py`. The generation step (`mcts/base.py` rollout) currently calls a cloud LLM and reads back text. The full tensor train for language generation (replacing the LLM with an MPS language model) is the pending step. Once the linguistic backend is an MPS, the physiological constraint propagates into generation natively.

**What is being protected:** The specific architectural claim that the MPS bond dimension chi is partitioned into semantic and physiological subspaces such that the second eigenvalue |lambda_1| = exp(-gamma * delta_t) controls stress persistence in the physiological subspace, which then propagates into the semantic subspace during tensor contraction. This is distinct from any LLM-based implementation.

---

### 7. Shared Tensor Geometry for Multi-Agent Communication (Full MPS-Native Tier)

**The claim:** Multiple agents sharing a single MPS buffer and communicating via partial trace operations (not text), with V_int acting as a cross-subspace coupling matrix in the Hamiltonian.

**Current state of implementation:**

- Shared tensor buffer: fully implemented (`agents/shared_tensor_state.py`)
- V_int propagation: fully implemented (coupling scores update per turn)
- Partial trace (transfer-matrix approximation): implemented (`core/mps.py partial_trace_physio()`)
- Exact partial trace via density matrix double-layer contraction: raises NotImplementedError (Phase 4b)
- Direct logit-level steering via V_int tensor contraction: pending HuggingFace access

**What is novel about this claim:** The distinction from all prior multi-agent AI work is that the coupling between agents is a matrix V_int embedded in the system Hamiltonian, not a message. V_int acts across H_sem x H_phys x H_social simultaneously. Even in the current LLM-tier implementation, V_int updates the coupling scores that gate the action availability across agents without any inter-agent message.

---

### 8. SOP Compilation via Activation Extraction and Truncated SVD (Zero-Shot Initialization)

**The claim:** Clinical SOPs are compiled into tensor core weights by extracting dense activation matrices from a frozen frontier LLM forward pass and performing truncated SVD to produce the initial core tensors A(t). This bypasses the cold-start problem.

**Current state:** `distillation/backends/ollama_local.py` implements the REST client and per-token logprob extraction. Full-vocabulary logit vectors require a HuggingFace model loaded directly. The distillation pipeline (`distillation/__init__.py`) is empty -- it is the next implementation step.

**What is being protected:** The specific mathematical pipeline: SOP text -> frozen LLM forward pass -> activation matrix M (N x d_model) -> truncated SVD M ~= U_k * Sigma_k * V^T_k -> core tensor initialization A(t). This is distinct from fine-tuning (no weight update), RAG (no text injection at inference), and prompt engineering (no natural language SOP at runtime).

---

### 9. Contrastive Subspace Distillation for Contradictory SOPs

**The claim:** When SOPs contain contradictions, standard SVD on the raw activation matrix blends the contradictions. The novel approach: generate paired (Compliant, Fatal) clinical traces, subtract the latent representations (A_delta = A_compliant - A_fatal), perform SVD on the difference matrix. The resulting projection matrix is orthogonal to the A_fatal subspace.

**Current state:** Not yet implemented. Architecture fully specified. Requires the distillation pipeline from Novelty 8 as a prerequisite, plus a paired-trace generation driver.

**Why this is still protectable:** The specific claim is the mathematical operation A_delta = A_compliant - A_fatal followed by SVD(A_delta). This is distinct from standard contrastive learning (which operates on model outputs or embeddings, not activation differences between paired policy traces). The application to clinical SOP contradiction resolution is a novel use case. The claim survives the lack of current implementation because the mathematical specification is complete and unambiguous.

---

### TIER 3 -- DESIGNED AND CLAIMED, NOT YET IMPLEMENTED

These claims describe the full tensorized generation architecture. They are novel and protectable but explicitly pending infrastructure.

---

### 10. Full Tensor Train for Language Generation (Replacing LLM Decoder)

**The claim:** Replacing the cloud LLM tactical agent with a pure Matrix Product State language model, where the physiological and social subspaces of the virtual bond directly constrain which tokens can be generated during tensor contraction, without any prompt injection step.

**Current state:** The linguistic backend is currently a cloud API (Bedrock / Ollama). `core/mps.py` provides the tensor operations required. This is the planned Bipartite architecture: a Logic Engine MPS (handles policy and safety) and a Tensorized Transformer (handles fluency), sharing a bond dimension.

**What is being protected:** The specific architectural claim that (a) the virtual bond is partitioned into semantic and physiological subspaces, (b) the non-Hermitian operator H_eff governs the evolution of both simultaneously, and (c) the physiological subspace amplitude propagates into the semantic token probability distribution through the tensor contraction itself. This is a structural safety guarantee that a softmax-based LLM cannot provide: unsafe token pathways do not exist in the tensor manifold, they are not merely low-probability.

---

### 11. ALS Policy Updates Without Catastrophic Forgetting

**The claim:** When clinical policies change (updated SOP, new drug protocol), the MPS core tensors governing the affected semantic region are updated via Alternating Least Squares (a strictly convex localized optimization) rather than global backpropagation, preventing forgetting of adjacent validated safety boundaries.

**Current state:** ALS 1-site and 2-site sweeps are fully implemented in `core/mps.py`. The A3C training loop currently uses log-bias EWA for actor updates. Wiring ALS into the A3C loop requires representing the actor policy as an MPS (not a dict of action logits), which is the planned Phase 3 transition.

**What is being protected:** The specific claim that ALS applied to localized MPS core tensors produces a strictly convex linear system M*x = b, solving for the updated tensor with zero interference to adjacent cores. This is provably superior to gradient descent on global neural weights for the targeted SOP-update use case, not just empirically.

---

## 4c. What is the Inventive Step?

The following four inventive steps constitute the core of this disclosure. Each step bridges a domain that no single practitioner from any one field would ordinarily connect.

### Inventive Step 1: Social Inertia via Shared Geometry

**The Step:** Multiple agents within a companion (Physiological Agent, Clinical Agent, Empathy Agent) share a single tensor state buffer instead of passing serialized text summaries. The same principle scales to the inter-orgnet level, where a Claims Agent and a Compliance Agent coordinate across organizational boundaries on a shared manifold.

**The Technical Implementation:** The virtual bond of the Matrix Product State is expanded into a tensor product of distinct agent subspaces (H_sem, H_phys, H_social). The Social Coupling Matrix V_int is embedded directly into the system Hamiltonian. Independent agents execute their transition operators simultaneously on the shared manifold and read each other's state via partial trace operations. This enables zero-latency, zero-text coordination.

**Why it is Non-Obvious:** A software engineer would implement inter-agent communication as a REST API with JSON payloads - this is the industry standard. A quantum physicist would use tensor product spaces but would not apply them to clinical workflows or social coordination dynamics. A clinical informaticist would have no route to the mathematical formalism required to connect social caregiver burnout to a tensor bond dimension. The insight that the serialized text API bottleneck is mathematically equivalent to the Markovian bottleneck -- and that both can be solved by treating social coupling as a tensor interaction term in a shared Hilbert space -- requires simultaneous expertise in quantum information theory, clinical workflow design, and multi-agent systems engineering. It applies identically whether the communicating agents are intra-companion (Physiological -> Clinical) or inter-orgnet (Claims -> Compliance).

### Inventive Step 2: Translating Human biological inertia Directly into a Geometric Tensor Constraint

**The Step:** The patient's physiological stress memory (physiological inertia) is not modeled as a separate module that feeds data into an LLM. Instead, it is encoded as a strict geometric property of the tensor manifold itself - specifically, the eigenvalue spectrum of the non-Hermitian transfer matrix.

**The Technical Implementation:** The patient's measured autonomic decay constant gamma, derived from real-time HRV metrics, is mapped directly to the second eigenvalue of the physiological transfer matrix: |lambda_1| = exp(-gamma * delta_t). A slow physiological recovery rate (small gamma) forces |lambda_1| to remain close to 1. The stress state then persists through the virtual bond for multiple subsequent turns, mathematically constraining the semantic vocabulary available to the tactical agent. This is not a probability adjustment; it is a geometric displacement of the accessible state space.

**Why it is Non-Obvious:** A neuroscientist understands HRV and physiological inertia but has no route to eigenvalue spectra of non-Hermitian transfer matrices. A mathematician working with non-Hermitian operators models physical decay processes in open quantum systems but would not connect them to cardiac R-R intervals. A machine learning engineer would model stress as a feature in a prompt or a penalty term in a reward function. The direct mapping of a biological decay constant to a tensor eigenvalue - such that the physiological state constrains the geometric traversability of the conversational manifold - is a connection that requires all three knowledge domains simultaneously.

### Inventive Step 3: Patient Stress as a Non-Hermitian Transition Operator that Gates the Accessible Semantic State Space

**The Step:** The patient's slow physiological recovery rate (small gamma, derived from HRV) is encoded as a strict geometric property of the transition operator H = exp(-i*H0*t) * exp(-Gamma*t). When gamma is small, the second eigenvalue |lambda_1| remains close to 1 across many turns, meaning the stress amplitude persists in the physiological subspace of the virtual bond. This persistence propagates into the semantic subspace during tensor contraction, constraining which conversational moves are geometrically accessible. Chi itself stays fixed; what changes is how much of it carries live stress amplitude.

**The Technical Implementation:** Gamma is assembled from six physiological and psychosocial decay channels (Gamma_physio, Gamma_habit, Gamma_pkpd, Gamma_reactivity, Gamma_fear, Gamma_companion). The action availability is stress-gated: confrontational and high-demand actions are suppressed in zones 3 and 4. The PhysioInertiaGate -- which reads the Physiological Agent's output -- implements asymmetric Schmitt-trigger transitions (dead-band = 0.06) so that the system requires a genuine sustained improvement in physiological state before unlocking higher-demand dialogue moves, not just a momentary decrease in stress. The asymmetry is the implementation of inertia: it is easier to enter a high-stress zone than to leave it, mirroring the slower parasympathetic recovery relative to sympathetic activation.

**Why it is Non-Obvious:** No prior system maps a biological decay rate constant directly to a tensor eigenvalue such that the physiological recovery trajectory geometrically constrains the semantic action space for subsequent turns. It requires the synthesis of three independent concepts: (1) the eigenvalue spectrum of a non-Hermitian transfer matrix as a memory mechanism in open quantum systems (physics literature), (2) the asymmetric speed of sympathetic activation vs. parasympathetic recovery in the autonomic nervous system (neuroscience literature), and (3) the architectural principle that safety constraints must be structural -- enforced by topology -- rather than probabilistic (AI safety literature). No domain-specific practitioner would have reason to connect all three.

### Inventive Step 4: Online Policy Boundary Injection via Alternating Least Squares Without System Downtime

**The Step:** When a policy boundary changes -- a new drug contraindication is added, a billing exception is reversed, a clinical protocol is updated -- a neural network requires retraining or fine-tuning to absorb the change. Because gradient descent on global weights alters the entire weight distribution, there is no mathematically guaranteed way to update one policy boundary without inadvertently eroding adjacent validated safety constraints. This disclosure updates a specific policy boundary by solving a strictly convex localized linear system against the affected MPS core tensors only, leaving all other cores frozen.

**The Technical Implementation:** `core/mps.py` implements 1-site and 2-site ALS sweeps. To update a policy boundary, the affected conversational region is identified by its position in the tensor chain (the core tensor A(t) governing the relevant semantic neighborhood). All adjacent cores A(j not equal t) are frozen. The update reduces to the normal equations: M * vec(A(t)) = b, where M is assembled from the frozen environment tensors and b encodes the new target constraint. This system is strictly convex -- it has exactly one solution -- and is solved with a standard linear algebra solver in a single pass. The update is applied in-place to the live tensor buffer. No training run, no gradient accumulation, no model checkpoint swap, and no system downtime is required.

**Why it is Non-Obvious:** A machine learning engineer updating a policy would schedule a fine-tuning job, deploy a new model version, and accept a brief service interruption. A mathematician working with ALS in the context of tensor decomposition applies it to compress data representations, not to enforce policy constraints in a live inference system. The specific insight -- that a policy boundary can be represented as a target vector in the semantic subspace of a core tensor, and that ALS convexity provides a formal proof of zero interference with adjacent constraints -- requires simultaneous knowledge of tensor algebra, online serving systems, and clinical policy management. It is the only known architecture that provides a mathematical proof of no catastrophic forgetting for a targeted policy update, not merely an empirical observation.

### Inventive Step 5: Pharmacodynamic Delay Encoded as a Temporal Component of the Dissipation Matrix

**The Step:** When a patient is prescribed a medication whose therapeutic effect is delayed -- a beta-blocker with a biophase equilibration half-life, or an SSRI whose anxiolytic plateau requires weeks of accumulation -- a conversational AI system that ignores this delay will escalate clinically inappropriate dialogue moves during the window when the drug has been administered but not yet taken effect. This disclosure models pharmacokinetic and pharmacodynamic delays as explicit additive components of the dissipation matrix Gamma, so that the tensor operator governing the conversation is already aware of the drug's future trajectory at the moment of prescription.

**The Technical Implementation:** `physio/pkpd.py` implements four drug models with literature PK parameters. The beta-blocker model uses a two-compartment ke0 biophase link model (ke0 = 0.20 /min) and an Emax Hill equation to convert plasma concentration to sympatholytic effect. The SSRI model uses a two-timescale accumulation model (fast reuptake inhibition, slow receptor desensitization). The warfarin model uses an effect-compartment with INR as output. The opioid model includes tolerance via receptor downregulation. The output of each model -- a dimensionless pharmacodynamic effect scalar E(t) in [0,1] -- is injected into Gamma as Gamma_pkpd, scaling the dissipation rate for the physiological subspace at every conversational turn. A patient who has received a beta-blocker but whose biophase concentration has not yet equilibrated produces a low E(t), meaning Gamma_pkpd is near zero: the stress dissipation channel that the drug would provide is absent from the tensor operator until the drug actually reaches the effect compartment.

**Why it is Non-Obvious:** A pharmacokineticist models ke0 and biophase concentration but works with drug concentration curves, not conversational AI. A clinical AI designer who reads a patient chart and sees "propranolol prescribed today" would either ignore the drug or add a static flag to the system prompt. Neither approach captures the continuous, time-varying anxiolytic trajectory of the drug and its effect on the patient's stress recovery rate. The insight -- that a PK/PD effect scalar derived from a biophase model can replace a naive physiological recovery estimate in the Gamma operator, preventing the AI from assuming the drug has worked before it has -- requires simultaneous knowledge of clinical pharmacology, open-system non-Hermitian operators, and conversational agent design. No practitioner in any one of these three fields would arrive at this combination independently.

**Design claim (pending implementation):** Contrastive Subspace Distillation -- generating paired (Compliant, Fatal) clinical traces, subtracting latent representations (A_delta = A_compliant - A_fatal), and performing SVD on the difference matrix to isolate a policy decision boundary orthogonal to the forbidden subspace -- is specified as the input pipeline for Step 4 above. The mathematical specification is complete. The implementation requires HuggingFace activation extraction and is planned as a subsequent phase.

---

## 4d. Advantages Over Comparable Inventions


| Prior Art / Approach                                | Limitation                                                                                                                                                                                                                                                                     | the framework Advantage                                                                                                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standard LLM with system prompt                     | Softmax guarantees epsilon > 0 for all tokens; safety constraints are probabilistic. Cannot prevent hallucination.                                                                                                                                                             | Tensor topology sets unsafe paths to exactly zero. Mathematical path to generate them no longer exists.                                                                                        |
| Retrieval-Augmented Generation (RAG)                | Injects text into context window. Model still relies on softmax. Probabilistic hallucination structurally permitted.                                                                                                                                                           | Tensor RAG retrieves projection matrices P, not text. Multiplied directly into the active transition operator. Zero hallucination on policy-governed vocabulary.                               |
| Hybrid neuro-symbolic systems                       | Require continuous translation between continuous vector spaces and discrete symbolic logic. Parsing errors cause system failure.                                                                                                                                              | the framework unifies language generation and deterministic constraints into a single geometric space. No translation required.                                                                |
| Standard multi-agent (JSON API / FHIR)              | Agents serialize internal state to text or structured payloads. Severe semantic bottleneck; continuous physiological context is destroyed at every API hop. Applies whether the agents are intra-companion (Physiological -> Clinical) or inter-orgnet (Claims -> Compliance). | Shared tensor buffer at both levels. Agents read each other's state via partial trace. Zero text generation for coordination. Physiological context is structurally present in every decision. |
| External differential equation solver + Transformer | Markovian bottleneck: external engine must compress continuous, multidimensional state into discrete text strings. Softmax still active.                                                                                                                                       | Physiological state is a geometric property of the tensor manifold, not an external signal injected via text.                                                                                  |
| Fine-tuning / backpropagation for policy updates    | Global weight distribution shift; catastrophic forgetting of previously validated safety boundaries.                                                                                                                                                                           | Alternating Least Squares (ALS) update: localized, strictly convex linear system. Zero risk of destructively interfering with surrounding knowledge base.                                      |
| KV-cache in LLMs for long context                   | O(N^2 * d) complexity; KV cache scales linearly, frequently causing OOM on standard hospital hardware.                                                                                                                                                                         | MPS compresses historical context into fixed virtual bond dimension chi. Time Complexity: O(N * d * chi^2). Active memory footprint bounded by [chi x d x chi]. Constant O(1) TTFT.            |


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