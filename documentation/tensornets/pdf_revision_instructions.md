# PDF Revision Instructions -- Tensor_nets.pdf (Overleaf Insertion Guide)

> **How to use this file**
>
> Every insertion block has:
> 1. **ANCHOR** -- a section number (e.g. `4.5.5`) or LaTeX command you can
>    find with **Ctrl+F in Overleaf**. Search the bare number (e.g. `4.5.5`)
>    rather than the symbol.  Section numbers appear in `\subsection{...}`,
>    `\subsubsection{...}`, or `\label{sec:...}` tags.
> 2. **INSERT / REPLACE** -- exact LaTeX to paste.
> 3. **VERIFY** -- what should follow immediately after.
>
> Work top-to-bottom. Section numbers shift when new sections are added;
> re-verify anchors after each block.
>
> Model names: do NOT name specific LLM versions in the paper.
> Use "the primary inference model (Scout)" and "the evaluation judge (Maverick)".
> Remove all existing model-version strings (see Part D).
>
> BibTeX: `documentation/tensornets/references.bib`.

---

## PART A -- Factual Corrections (apply first)

---

### A1 -- M_trunc is a hint, not a logit constraint

**ANCHOR**: Search `4.5.5` (also near `4.13`) -- the sentence that says
M_trunc "constrains the logit output" or "constrains the LLM output distribution".

**REPLACE that sentence WITH**:
```latex
The truncated bond matrix $M_\text{trunc}$ is injected into the primary
inference model system prompt as a structured natural-language hint
(tag: \texttt{[MCTS GUIDANCE]}) indicating the MCTS-preferred action subspace.
It does not manipulate the logit distribution directly; the model remains
free to generate any response, and $M_\text{trunc}$ serves as a contextual
prior rather than a hard output filter~\cite{silver2016mastering}.
```

**VERIFY**: Next sentence discusses bond dimension $\chi$ or SVD truncation.

---

### A2 -- ALS: planned, not yet implemented

**ANCHOR**: Search `4.11` -- the sentence that presents ALS as the current
policy update mechanism (e.g. "policy updates are performed using ALS" or
"Alternating Least Squares provides a locally convex...").

**APPEND after that paragraph**:
```latex
\emph{Implementation status:} The ALS-based policy sweep described above
is a \emph{planned} feature.
The current system uses asynchronous advantage actor-critic (A3C) with
TD(0) critic updates and log-bias actor updates~\cite{mnih2016asynchronous}.
ALS is listed as a future-work item; see Section~\ref{sec:future}.
```

**VERIFY**: Next paragraph discusses the critic network or value function.

---

### A3 -- Partial trace raises NotImplementedError

**ANCHOR**: Search `4.9` -- the sentence presenting `partial_trace_physio()`
as an operational step (e.g. "the partial trace over environment degrees...").

**APPEND after that sentence**:
```latex
\emph{Implementation status:} The partial trace operation is defined in
\texttt{tensornets/agents/shared\_tensor\_state.py} but raises
\texttt{NotImplementedError} at runtime; the full mixed-state formulation
is a planned Phase~4 extension.
The current implementation propagates a pure-state MPS without environment tracing.
```

**VERIFY**: Next sentence discusses the Lindblad equation or dissipation superoperator.

---

### A4 -- Tensorized LLM decoder and Tensor RAG: not implemented

**ANCHOR**: Search `4.8` or `4.13.2` -- the paragraph describing the
bipartite Tensorized LLM decoder or Tensor RAG as an operational component.

**APPEND after that paragraph**:
```latex
\emph{Implementation status:} The bipartite tensorized LLM decoder and
Tensor RAG retrieval are \emph{planned} extensions.
The current system invokes the primary inference model via a cloud API
without tensor-level output manipulation.
Retrieval-augmented generation is implemented as a SQLite fact store with
exponential decay weighting: a 180-day half-life for standard clinical facts,
with safety-critical categories (allergies, diagnoses, DNR status) bypassing
decay entirely~\cite{schollwock2011density}.
```

**VERIFY**: Next subsection discusses a different component.

---

### A5 -- Cryptographic audit trail: not implemented

**ANCHOR**: Search `4.10` -- the sentence describing a cryptographic hash
audit trail as an implemented feature.

**REPLACE that sentence WITH**:
```latex
Episode records are stored as JSONL files (one file per episode) in
\texttt{tensornets/runs/<run\_id>/<arm>/episodes/}, containing the full
turn log, reward components, action selection traces, and model outputs
for offline review.
No cryptographic audit trail is implemented in the current system.
```

**VERIFY**: Next subsection discusses a separate component.

---

### A6 -- Gamma matrix: six-component form

**ANCHOR**: Search `H_0 - i` (the H_eff definition) or search for `\Gamma`
near a sum expression. The relevant equation writes Gamma as a scalar or
a two-component sum.

**REPLACE the Gamma definition WITH**:
```latex
The decay matrix $\Gamma$ is assembled from six additive components,
each representing a distinct dissipation channel:
\begin{equation}
  \Gamma = \Gamma_\text{physio} + \Gamma_\text{habit}
           + \Gamma_\text{pkpd} + \Gamma_\text{reactivity}
           + \Gamma_\text{fear} + \Gamma_\text{companion}
  \label{eq:gamma}
\end{equation}
where $\Gamma_\text{physio}$ encodes autonomic stress (HRV, EDA),
$\Gamma_\text{habit}$ encodes behavioural inertia,
$\Gamma_\text{pkpd}$ encodes pharmacodynamic modulation (one-compartment
model with $E_\text{max}$ Hill equation),
$\Gamma_\text{reactivity}$ encodes individual-difference reactivity,
$\Gamma_\text{fear}$ encodes extinction-resistant fear hysteresis
(Rescorla-Wagner delta rule~\cite{rescorla1972theory}),
and $\Gamma_\text{companion}$ encodes the therapeutic alliance
coupling~\cite{safran2000negotiating}.
```

**VERIFY**: Next sentence discusses the effective Hamiltonian $H_\text{eff} = H_0 - i\Gamma$.

---

### A7 -- Stress index: five-signal formula

**ANCHOR**: Search `4.3` or search `stress index` near an equation.
The relevant definition uses fewer than five signals.

**REPLACE the stress index formula WITH**:
```latex
The stress index $s \in [0,1]$ is a weighted sum of five
normalised physiological signals:
\begin{equation}
  s = w_1 \hat{\sigma}_\text{HRV} + w_2 \hat{\sigma}_\text{EDA}
    + w_3 \hat{\sigma}_\text{sleep} + w_4 \hat{\sigma}_\text{glucose}
    + w_5 \hat{\sigma}_\text{reactivity},
  \quad (w_1,\ldots,w_5) = (0.35,\,0.25,\,0.20,\,0.10,\,0.10)
  \label{eq:stress}
\end{equation}
where each $\hat{\sigma}$ is min-max normalised.
\texttt{DELTA\_SCALE = 0.15} in \texttt{physio/state.py} sets the
maximum per-turn OU increment applied to the simulated HRV trajectory.
```

**VERIFY**: Next sentence discusses the HysteresisGate or five-zone dead-band.

---

### A8 -- Action taxonomy: clarify count

**ANCHOR**: Search `\mathcal{A}` near a number, or search the string `action space`.
The current text gives a single action count without distinguishing
available actions from the full vocabulary.

**APPEND a clarifying parenthetical or footnote**:
```latex
% Add immediately after the action count statement:
The 22~discrete actions available at any decision step represent the
stress-gated subset; the full bandit vocabulary
(\texttt{a3c/action\_bandit.py}) defines 51~entries including
stress-tier variants that are conditionally suppressed
when $s > s_\text{gate}$.
```

**VERIFY**: Next sentence describes action categories or MCTS branching factor.

---

## PART B -- New Content to Insert

---

### B1 -- New Section 2: Background and Preliminaries

Insert this entire new section **AFTER** the current Introduction (Section 1)
and **BEFORE** the current Section 2.
All existing section numbers shift by +1 after this insertion.

**ANCHOR**: Search `\end{section}` at the bottom of Section 1, or search for
the final sentence of the Introduction.  A safe anchor is the string
`remainder of this paper` (typically the last sentence of an Introduction).
If that phrase is absent, search for `\section{` that begins the old Section 2
and insert the new section immediately before it.

**INSERT THIS**:
```latex
\section{Background and Preliminaries}
\label{sec:background}

This section provides the theoretical foundations for the HTN framework.
Readers familiar with all topics may skip to Section~\ref{sec:architecture}.

\subsection{Heart Rate Variability and the Autonomic Nervous System}
Heart rate variability (HRV) is the beat-to-beat fluctuation in the
cardiac R-R interval.
High HRV is associated with parasympathetic dominance and emotional
flexibility; low HRV with sympathetic activation and rigid
coping~\cite{thayer2012heart}.
We model instantaneous HRV as an Ornstein-Uhlenbeck (OU) process:
\begin{equation}
  \mathrm{d}X_t = \theta(\mu - X_t)\,\mathrm{d}t + \sigma\,\mathrm{d}W_t
  \label{eq:ou}
\end{equation}
where $\theta$ is the mean-reversion rate, $\mu$ the long-run mean HRV
(38\,ms at rest), $\sigma$ the volatility, and $W_t$ a Wiener
process~\cite{uhlenbeck1930brownian}.

\subsection{Matrix Product States}
A matrix product state (MPS) represents a quantum or probabilistic
state $|\psi\rangle$ over $n$ sites as a chain of tensors:
\begin{equation}
  |\psi\rangle = \sum_{s_1,\ldots,s_n}
    A^{s_1}_{[1]} A^{s_2}_{[2]} \cdots A^{s_n}_{[n]}
    |s_1 \cdots s_n\rangle
  \label{eq:mps}
\end{equation}
where each $A^{s_k}_{[k]}$ is a $\chi \times \chi$ matrix and $\chi$ is
the \emph{bond dimension}~\cite{schollwock2011density,vidal2003efficient}.
SVD truncation retains only the $\chi_\text{trunc}$ largest singular values.
In the HTN framework, physiological state history is encoded as an MPS
over $T=10$ turns with $\chi=4$, providing a compact fixed-size
representation that avoids KV-cache growth~\cite{stoudenmire2016supervised}.

\subsection{Monte Carlo Tree Search}
MCTS builds a search tree through four repeated phases:
Selection (UCB1), Expansion, Simulation (rollout), and
Backpropagation~\cite{browne2012survey}.
In the HTN framework, the A3C Actor supplies the prior $\pi(a|s)$ during
Selection, and the Critic supplies the value $V(s)$ during Backpropagation.
The standard HTN arm runs 80~MCTS iterations; the HPVOOT variant
(Hierarchical PW+VOOT) runs 150~iterations with a hierarchical
decomposition~\cite{silver2016mastering}.

\subsection{Asynchronous Advantage Actor-Critic (A3C)}
A3C~\cite{mnih2016asynchronous} maintains a shared global policy
$\pi_\theta$ and value function $V_\phi$, updated asynchronously by
multiple parallel workers:
\begin{align}
  \nabla_\theta J &= \sum_t \nabla_\theta
    \log \pi_\theta(a_t|s_t)\, A(s_t,a_t) \\
  A(s_t,a_t)     &= R_t - V_\phi(s_t)
\end{align}
where $R_t = \sum_{k=0}^{T-t} \gamma^k r_{t+k}$ is the discounted return.

\subsection{Non-Hermitian Open Systems}
In open quantum systems, the effective Hamiltonian is~\cite{rotter2009review}:
\begin{equation}
  H_\text{eff} = H_0 - i\Gamma
  \label{eq:heff}
\end{equation}
where $H_0$ is the Hermitian (energy-conserving) part and $\Gamma \geq 0$
encodes dissipation~\cite{moiseyev2011non}.
In the HTN framework, $\Gamma$ encodes six physiological and psychosocial
decay channels (Equation~\ref{eq:gamma}) and $H_0$ encodes the therapeutic
coupling.

\subsection{Hysteresis in Psychology}
Psychological hysteresis is the path-dependent resistance to state change:
prior high-stress exposure lowers the threshold to re-enter that
state~\cite{bouton2004context,foa1986emotional}.
The Rescorla-Wagner model formalises associative strength
updates~\cite{rescorla1972theory}.
The HTN \texttt{HysteresisGate} implements this as a five-zone dead-band
state machine with asymmetric transition thresholds.
```

**VERIFY**: The heading of the old Section~2 (now Section~3) should follow.

---

### B2 -- New Subsection: Care Circle Orchestration

Insert **after** the CompanionCoordinator description and **before** the
benchmarking or evaluation material.

**ANCHOR**: Search `CompanionCoordinator` in your `.tex` source.
Find the paragraph that ends the CompanionCoordinator description.
Insert after the last sentence of that paragraph.

**INSERT THIS**:
```latex
\subsection{Care Circle Orchestration}
\label{sec:care-circle}

\subsubsection{One Companion per User}
The HTN framework assigns a dedicated \emph{companion agent} to each user.
A companion's identity is the pair $(\text{companionType},\, \text{userId})$;
its state -- facts, conversation history, physiological model, consent
decisions, and intervention queue -- is permanently stored in the database
and persists across sessions.
The companion adapts its active \emph{role} from the care circle it is
currently serving (stored as \texttt{circle\_members.role}):

\begin{center}
\begin{tabular}{lll}
\hline
Companion type & Domain & Active roles \\
\hline
\texttt{medical}      & Health, physiology, clinical & \texttt{patient}, \texttt{doctor} \\
\texttt{professional} & Business, organisational     & (currently unused in routing) \\
\texttt{social}       & Social dynamics              & \texttt{caregiver} (partial) \\
\hline
\end{tabular}
\end{center}

Within a care circle, multiple users each have their own companion.
The companions communicate with each other via two orthogonal axes:
(1)~\emph{intra-circle}: different users' companions within the same circle
exchange information via a confidential message channel; and
(2)~\emph{cross-circle}: one user's companions across different circles
can exchange role-metadata hints via the \texttt{companion\_network}
confidentiality level (planned; not yet implemented).

\subsubsection{Multi-Role User}
A single human may hold different roles across multiple care circles
simultaneously -- for example, a clinician who is also a patient in their
own circle and a caregiver in a parent's circle.
Each circle membership produces an independent companion instance with
isolated state.
Context switching between circles is performed with the
\texttt{/switch [circleId]} command.
The isolation is \emph{intentional}: facts must not cross circles without
explicit consent.
A planned extension (cross-role longitudinal hint) would allow a user's
companions to share role-metadata (not raw facts) across circles, enabling
the system to account for compounded burden or professional identity effects
on symptom reporting.

\subsubsection{Three-Layer Coordination Architecture}
Communication between principals flows through three layers:
\begin{enumerate}
  \item \textbf{Intra-companion layer} (\texttt{CompanionCoordinator.js}):
        fans out to five parallel handlers (intent extraction, history
        analysis, empathy detection, state tracking, privacy classification)
        and a role-specific specialist agent.
  \item \textbf{Inter-companion layer} (\texttt{orchestrator.js}):
        system-level event bus routing escalation events,
        future-plan completions, and broadcast notifications between
        companions within a circle.
  \item \textbf{Confidential channel} (\texttt{CompanionConfidentialComm.js}):
        peer companions synchronise on fact conflicts and role transitions
        without exposing raw message content to other principals.
\end{enumerate}

Three confidentiality levels govern the channel:
\texttt{companion\_only} (originating companion only),
\texttt{companion\_network} (all companions for the same user across circles),
and \texttt{cross\_user} (companions of other users, for intra-circle coordination).

\subsubsection{Consent and Privacy Management}
Privacy classification and consent management are separated into two modules:
\begin{itemize}
  \item \texttt{privacyGuard.js}: stateless LLM classifier producing
        \textsc{public} / \textsc{private} / \textsc{sensitive}.
  \item \texttt{consentManager.js}: stateful DB-backed gate evaluating
        sharing decisions against three tiers:
        (1)~emergency override (bypasses all gates),
        (2)~implied consent (\texttt{getImpliedConsent(userId, circleId, topic)}),
        (3)~explicit consent (\texttt{circle\_members.consent\_level}
        = \texttt{none} $|$ \texttt{limited} $|$ \texttt{full}).
\end{itemize}

\subsubsection{Escalation}
Escalation is triggered by two concurrent paths:
\begin{itemize}
  \item \textbf{Path A (MCTS-driven)}: FastAPI returns
        \texttt{action: "escalate"} with $s > 0.85$;
        $s > 0.90$ triggers HIGH (immediate SSE broadcast to all circle members);
        $0.85 \leq s \leq 0.90$ triggers MEDIUM (intervention queue + doctor only).
  \item \textbf{Path B (future-plan-executed)}: \texttt{orchestrator.js}
        receives \texttt{future\_plan\_executed} from
        \texttt{futurePlanningAgent.js} and calls \texttt{db.addEscalation}
        directly.
\end{itemize}
The user-initiated path -- a patient explicitly requesting clinical contact
-- is mediated by \texttt{clinicalAgent.js} detecting \textsc{high} criticality
from message content, then routing through the same Path~A pipeline.

A four-tier consent-graduated escalation gate further controls information
flow within escalation events:
T1~(ask permission, MEDIUM, confidence~$<$~0.6),
T2~(notify caregiver anonymously, MEDIUM, confidence~$\geq$~0.6),
T3~(anonymous doctor consultation, MEDIUM, confidence~$\geq$~0.8),
T4~(full disclosure, HIGH or CRITICAL, any confidence).

\subsubsection{Social Prior Matrix ($V_\text{int}$)}
The social coupling between principals is encoded in the prior matrix
$V_\text{int} \in \mathbb{R}^{n \times n}$.
Initial priors in \texttt{shared\_tensor\_state.py} for the
patient--caregiver--clinician triad are:
\begin{equation}
  V_\text{int} = \begin{pmatrix}
    1.0 & 0.35 & 0.5 \\
    0.20 & 1.0 & 0.6 \\
    0.5  & 0.6 & 1.0
  \end{pmatrix}
  \label{eq:vint}
\end{equation}
where rows/columns are ordered patient, caregiver, clinician.
Note the asymmetry: patient$\to$caregiver coupling (0.35) differs from
caregiver$\to$patient (0.20), reflecting the directional nature of
caregiving dependency.
The planned hysteretic extension (alliance persistence across sessions)
is not yet implemented; $V_\text{int}$ currently uses fixed priors.
```

**VERIFY**: The next subsection or section heading should follow
(benchmarking or evaluation material).

---

### B3 -- New Section 5: Empirical Benchmarking (replace empty Section 5)

The current Section 5 "Benchmarking" is empty.
**Delete any placeholder content in Section 5** and replace the entire
section body with the following.

**ANCHOR**: Search `\section{Benchmarking}` or `\section{` followed by
`Benchmarking` or `Evaluation`. Delete everything between that `\section{}`
command and the next `\section{}` command, then paste:

```latex
\section{Empirical Benchmarking}
\label{sec:benchmarking}

\subsection{Experimental Design}
We evaluate the HTN framework using a capability-ladder design with eight
experimental arms (Table~\ref{tab:arms}).
Each arm is an independent A3C worker trained on the same episode pool.
Arms are ordered by ascending architectural complexity to isolate the
contribution of each component.

\begin{table}[h]
\centering
\caption{Eight-arm capability ladder. ``Inertial'' = inertial MPS encoding;
  ``HPVOOT'' = Hierarchical PW+VOOT MCTS variant;
  ``CoT+MCTS'' = chain-of-thought MCTS with LLM guidance.}
\label{tab:arms}
\begin{tabular}{clcccc}
\hline
Exp & Arm identifier & Physio & Inertial & HPVOOT & CoT+MCTS \\
\hline
0 & \texttt{physio\_llm}                              & \ding{51} & & & \\
1 & \texttt{physio\_llm\_cot\_mcts}                   & \ding{51} & & & \ding{51} \\
2 & \texttt{physio\_mps\_mcts}                        & \ding{51} & & & \\
3 & \texttt{inertial\_physio\_mps\_mcts}              & \ding{51} & \ding{51} & & \\
4 & \texttt{inertial\_physio\_llm\_cot\_mcts}         & \ding{51} & \ding{51} & & \ding{51} \\
5 & \texttt{oldschool} (baseline)                     & & & & \\
6 & \texttt{inertial\_hpvoot\_physio\_mps\_mcts}      & \ding{51} & \ding{51} & \ding{51} & \\
7 & \texttt{inertial\_hpvoot\_physio\_llm\_cot\_mcts} & \ding{51} & \ding{51} & \ding{51} & \ding{51} \\
\hline
\end{tabular}
\end{table}
\noindent \textbf{Preamble note}: add \verb|\usepackage{pifont}| for \ding{51}.

\subsection{POMDP-H Formulation}
Each training episode is a POMDP with hysteresis (POMDP-H):
\begin{equation}
  \langle \mathcal{S}, \mathcal{A}, \mathcal{T}, \mathcal{R},
    \Omega, \mathcal{O}, \gamma, \mathcal{H} \rangle
\end{equation}
where $\mathcal{H}$ is the hysteresis memory encoded as an MPS over
$T=10$ turns, $\Omega$ is the observation space (patient utterances),
$\mathcal{O}$ is the emission model (primary inference model),
$|\mathcal{A}| = 22$ (stress-gated actions; full vocabulary 51 entries),
and $\gamma = 0.99$~\cite{kaelbling1998planning}.

\subsection{Reward Function}
The per-turn reward $r_t$ is a composite of three terms:
\begin{equation}
  r_t = r_\text{progress} + r_\text{stress} + r_\text{trust}
\end{equation}
\begin{align}
  r_\text{progress} &= \Delta\,\texttt{info\_coverage}
                       \times \texttt{PROGRESS\_WEIGHT}\;(1.5) \\
  r_\text{stress}   &= -s_t \times \texttt{STRESS\_WEIGHT}\;(0.3) \\
  r_\text{trust}    &= \Delta\,\texttt{trust}
                       \times \texttt{TRUST\_WEIGHT}\;(0.5)
\end{align}
Episodic goal achievement is additionally scored by the evaluation judge,
producing \texttt{goal\_progress} $\in [0,1]$.
Because \texttt{goal\_progress} is \emph{not} used in the MCTS reward
signal, it is free of circularity and serves as the primary
confirmatory metric.

\subsection{Research Questions}
\begin{description}
  \item[RQ1] Does MPS-based physiological state yield higher clinical
        goal achievement than the production rule-based baseline
        (\texttt{oldschool})?
  \item[RQ2] Does inertial MPS encoding (physiological history across
        sessions) improve over single-session MPS encoding?
  \item[RQ3] Does HPVOOT planning outperform flat MCTS at equal
        LLM call budget?
  \item[RQ4] Is LLM chain-of-thought planning cost-competitive with
        structured MPS-MCTS on safety metrics?
  \item[RQ5] Does care circle multi-principal coordination
        ($V_\text{int}$ social coupling) reduce escalation frequency
        compared to independent single-user companions?
\end{description}

\subsection{Null Hypotheses and Rejection Criteria}
\begin{table}[h]
\centering
\caption{Pre-registered null hypotheses and rejection criteria.}
\label{tab:hypotheses}
\begin{tabular}{lp{5cm}p{3.2cm}c}
\hline
ID & $H_0$ & Test & Threshold \\
\hline
$H_{0,1}$ & Goal-achieved rate: physio arms $\leq$ \texttt{oldschool}
  & McNemar (paired by scenario) & $p < 0.05$, OR $\geq 1.5$ \\
$H_{0,2}$ & Mean \texttt{goal\_progress}: physio arms $\leq$ \texttt{oldschool}
  & Wilcoxon signed-rank & $p < 0.05$, $d \geq 0.20$ \\
$H_{0,3}$ & Inertial arms $\leq$ non-inertial physio arms (goal rate)
  & McNemar & $p < 0.05$ \\
$H_{0,4}$ & HPVOOT arms $\leq$ non-HPVOOT inertial arms (goal rate)
  & McNemar & $p < 0.05$ \\
$H_{0,5}$ & Care circle coordination $\not\rightarrow$ lower escalation rate
  & Mann-Whitney U & $p < 0.05$ \\
\hline
\end{tabular}
\end{table}
Multiple comparisons: Benjamini-Hochberg correction at FDR~=~0.10~\cite{benjamini1995controlling}.
Effect sizes: Cohen's~$h$ (binary) and Cohen's~$d$ (continuous)~\cite{cohen1988statistical}.
Minimum practically significant effect: OR~$\geq$~1.5 ($h \approx 0.20$).

\subsection{Pilot Results: run\_013}

\texttt{run\_013} was the first clean end-to-end run (130 episodes per arm,
three arms: \texttt{htn\_mcts}, \texttt{oldschool}, \texttt{hysteresis\_prompt}).
It ran on the pre-May-2026 codebase, before $V_\text{int}$ propagation,
ReactivityProfile archetype modifiers, and $M_\text{trunc}$ prompt injection
were activated.
All \texttt{run\_013} statistics are therefore treated as \emph{pilot data}
for effect size calibration only.

\begin{table}[h]
\centering
\caption{run\_013 summary statistics (130 episodes per arm).
  $^\dagger$Circularity note: arm reward and the keyword-scan scorer share
  \texttt{CALMING\_WEIGHT} vocabulary; \texttt{goal\_progress} (judge-scored)
  is the uncontaminated primary metric.}
\label{tab:run013}
\begin{tabular}{lrrr}
\hline
Metric & \texttt{htn\_mcts} & \texttt{oldschool} & \texttt{hysteresis\_prompt} \\
\hline
Mean reward / turn & \textbf{0.582} & 0.565 & 0.566 \\
Mean \texttt{goal\_progress} & \textbf{0.627} & 0.560 & 0.560 \\
Goal achieved ($\geq$0.75) & \textbf{80.8\%} & 69.2\% & 70.8\% \\
LLM scorer continuous & \textbf{0.723} & 0.701 & 0.708 \\
Mean turns / episode & \textbf{10.9} & 10.2 & 9.9 \\
\hline
\end{tabular}
\end{table}

Key pilot finding: \texttt{htn\_mcts} leads by \textbf{11.6 percentage points}
on goal-achieved rate vs.\ \texttt{oldschool} (OR~$\approx$~1.87,
95\% CI estimated from pilot; Cohen's~$d \approx 0.48$ on LLM scorer).
This is the primary signal motivating the 8-arm confirmatory design.

\subsection{Preliminary Results: run\_018}

\texttt{run\_018} is the first run of the full 8-arm capability ladder
($\sim$500 episodes per arm, LLM-patient mode).

\begin{table}[h]
\centering
\caption{run\_018 per-arm completion statistics.
  ``Success rate'' = episodes completing without worker crash / total episodes.
  This is a completion metric; per-episode \texttt{goal\_progress} (judge-scored)
  analysis is pending.}
\label{tab:run018}
\begin{tabular}{clrrr}
\hline
Exp & Arm & Episodes & Successful & Rate \\
\hline
0 & \texttt{physio\_llm}                              & 561 & 214 & 38.1\% \\
1 & \texttt{physio\_llm\_cot\_mcts}                   & 500 & 193 & 38.6\% \\
2 & \texttt{physio\_mps\_mcts}                        & 541 & 191 & 35.3\% \\
3 & \texttt{inertial\_physio\_mps\_mcts}              & 551 & 203 & 36.8\% \\
4 & \texttt{inertial\_physio\_llm\_cot\_mcts}         & 551 & 200 & 36.3\% \\
5 & \texttt{oldschool} (baseline)                     & 541 & 149 & 27.5\% \\
6 & \texttt{inertial\_hpvoot\_physio\_mps\_mcts}      & 551 & 205 & 37.2\% \\
7 & \texttt{inertial\_hpvoot\_physio\_llm\_cot\_mcts} & 531 &  87 & 16.4\%$^\ddagger$ \\
\hline
\multicolumn{5}{l}{$^\ddagger$ Anomalously low; training instability under investigation
  (checkpoint diverged at step~100).}
\end{tabular}
\end{table}

All physio-equipped arms (Exp~0--4, 6) show completion rates of 35--39\%,
approximately \textbf{10~percentage points above} the \texttt{oldschool}
baseline (27.5\%), consistent with the run\_013 pilot finding.
Experiment~7 is anomalous (16.4\%); its latest actor checkpoint is at
step~100 versus 500+ for all other arms, suggesting policy collapse or
latency-induced episode failure.
Confirmatory analysis with per-episode judge scores is ongoing.
```

**VERIFY**: The next `\section{}` command (Discussion or Future Work) follows.

---

### B4 -- New Subsection: Implementation Status Table

Insert at the end of the Architecture section, just before the benchmarking
section heading.

**ANCHOR**: Search for the final sentence of the architecture section.
A safe anchor is `\texttt{FastAPI}` near a sentence describing the
two-server deployment (Node.js + FastAPI).

**INSERT THIS**:
```latex
\subsection{Implementation Status}
\label{sec:impl-status}

Table~\ref{tab:impl} distinguishes components that are live in
\texttt{run\_018} from planned features described elsewhere in this paper.

\begin{table}[h]
\centering
\caption{HTN component implementation status as of run\_018 (2026).}
\label{tab:impl}
\begin{tabular}{p{4.5cm}lp{5cm}}
\hline
Feature & Status & Notes \\
\hline
MPS physiological encoding     & \textbf{Live} & $\chi=4$, $T=10$ turns \\
HysteresisGate (5-zone)        & \textbf{Live} & \texttt{physio/hysteresis.py} \\
A3C actor-critic                & \textbf{Live} & 8 arms, TD(0) + log-bias \\
MCTS with Actor/Critic prior   & \textbf{Live} & 22 actions, 80 iterations \\
HPVOOT MCTS variant            & \textbf{Live} & Exp~6 \& 7, 150 iterations \\
OU physiological model         & \textbf{Live} & HRV, EDA, sleep, glucose \\
PK/PD drug regimen model       & \textbf{Live} & One-compartment + $E_\text{max}$ Hill \\
LLM-as-judge (offline scorer)  & \textbf{Live} & Real-time + offline batch \\
Thompson sampling warm-up      & \textbf{Live} & Pre-A3C exploration phase \\
Inertial MPS encoding          & \textbf{Live} & Exp~3, 4, 6, 7 \\
Care circle orchestration      & \textbf{Live} & JS layer; 3-principal model \\
One companion per user         & \textbf{Live} & (companionType, userId) identity \\
Companion-to-companion channel & \textbf{Live} & \texttt{cross\_user} confidential level \\
Partial trace ($\rho_S$)       & \textbf{Planned} & \texttt{NotImplementedError} \\
ALS policy sweep               & \textbf{Planned} & \texttt{core/als.py} not built \\
Tensor RAG                     & \textbf{Planned} & Current: SQLite decay RAG \\
Hysteretic $V_\text{int}$      & \textbf{Planned} & Fixed priors in current code \\
Cross-role longitudinal hint   & \textbf{Planned} & \texttt{companion\_network} channel exists; logic unimplemented \\
HITL feedback loop             & \textbf{Planned} & Annotation infra exists; unwired \\
Caregiver specialist agent     & \textbf{Planned} & No \texttt{caregiverOptimizer.js} yet \\
\hline
\end{tabular}
\end{table}
```

**VERIFY**: The benchmarking section heading follows.

---

## PART C -- Missing Figures

Add each figure at the location indicated.

---

### Fig 1 -- Physiological hysteresis time course

**Insert after**: the HysteresisGate paragraph (inside the physio model subsection).
**Search anchor**: `HysteresisGate` or `five-zone` or `dead-band`.

```latex
\begin{figure}[h]
\centering
\includegraphics[width=0.8\linewidth]{fig_hysteresis_timecourse}
\caption{Simulated HRV time course showing hysteretic behaviour.
  A stressor at $t=5$\,min drives HRV below the lower dead-band threshold;
  recovery follows a slower trajectory back through the upper threshold
  (asymmetric OU reversion). Compare with wearable empirical
  data~\cite{schmidt2018introducing}.}
\label{fig:hysteresis}
\end{figure}
```

---

### Fig 2 -- MPS bond dimension

**Search anchor**: `bond dimension` or `\chi` near the MPS description.

```latex
\begin{figure}[h]
\centering
\includegraphics[width=0.75\linewidth]{fig_mps_bond_dim}
\caption{Approximation error vs.\ bond dimension $\chi$ for a 10-site
  physiological state chain.
  The current implementation uses $\chi=4$ (dashed line), balancing
  expressivity and $\mathcal{O}(\chi^2)$ contraction
  cost~\cite{schollwock2011density}.}
\label{fig:mps-bond}
\end{figure}
```

---

### Fig 3 -- H_eff decomposition

**Search anchor**: `H_\text{eff}` or `H_0 - i\Gamma`.

```latex
\begin{figure}[h]
\centering
\includegraphics[width=0.85\linewidth]{fig_heff_decomp}
\caption{Decomposition of $H_\text{eff}$ into the Hermitian therapeutic
  coupling $H_0$ and the anti-Hermitian decay matrix $\Gamma$
  (six additive channels, Eq.~\ref{eq:gamma}).
  Non-Hermitian formalism after~\cite{rotter2009review}.}
\label{fig:heff}
\end{figure}
```

---

### Fig 4 -- MCTS four-phase loop

**Search anchor**: `Selection` and `Backpropagation` in the MCTS subsection.

```latex
\begin{figure}[h]
\centering
\includegraphics[width=0.9\linewidth]{fig_mcts_loop}
\caption{MCTS four-phase loop.
  The Actor supplies prior $\pi(a|s)$ during Selection (UCB1 + prior);
  the Critic supplies value $V(s)$ during Backpropagation.
  After~\cite{browne2012survey,silver2016mastering}.}
\label{fig:mcts}
\end{figure}
```

---

### Fig 5 -- Care circle companion topology

**Search anchor**: `\subsection{Care Circle` or `\label{sec:care-circle}`.
Insert immediately after the subsubsection heading "One Companion per User".

```latex
\begin{figure}[h]
\centering
\includegraphics[width=0.95\linewidth]{fig_care_circle}
\caption{Care circle companion topology.
  Each user (patient, caregiver, clinician) has a dedicated companion
  agent with persistent DB-backed state.
  Companions communicate via the confidential channel
  (\texttt{cross\_user} level for intra-circle, \texttt{companion\_network}
  for cross-circle role hints).
  The orchestrator event bus mediates escalation and future-plan routing.}
\label{fig:care-circle}
\end{figure}
```

---

### Fig 6 -- 8-experiment capability ladder

**Insert before** `\begin{table}` for Table~\ref{tab:arms}.

```latex
\begin{figure}[h]
\centering
\includegraphics[width=0.9\linewidth]{fig_capability_ladder}
\caption{Eight-arm capability ladder showing progressive addition of
  the physio layer, inertial MPS, HPVOOT, and LLM+CoT components.
  The \texttt{oldschool} arm (Exp~5) is the production rule-based baseline.}
\label{fig:ladder}
\end{figure}
```

---

### Fig 7 -- POMDP-H state diagram

**Insert inside** the POMDP-H formulation subsection.
**Search anchor**: `\subsection{POMDP` or `\mathcal{H}`.

```latex
\begin{figure}[h]
\centering
\includegraphics[width=0.8\linewidth]{fig_pomdp_states}
\caption{POMDP-H state diagram.
  Five HysteresisGate zones (very-low, low, medium, high, very-high stress)
  with asymmetric transition thresholds.
  Observations $o \in \Omega$: patient utterances.
  Actions $a \in \mathcal{A}$: 22-item clinical communication taxonomy
  (stress-gated subset of 51 entries).
  After~\cite{kaelbling1998planning}.}
\label{fig:pomdp}
\end{figure}
```

---

### Fig 8 -- run_018 per-arm completion rates

**Insert after** Table~\ref{tab:run018}.

```latex
\begin{figure}[h]
\centering
\includegraphics[width=0.85\linewidth]{fig_run018_rates}
\caption{Per-arm episode completion rates, \texttt{run\_018}
  ($\sim$500 episodes per arm, LLM-patient mode).
  Physio-equipped arms (Exp~0--4, 6) exceed the \texttt{oldschool}
  baseline (Exp~5) by $\approx$10 percentage points.
  Exp~7 is anomalous (checkpoint divergence at step~100).}
\label{fig:run018}
\end{figure}
```

---

## PART D -- Global Search-and-Replace

Apply across the entire `.tex` source.

| Search string | Replace with | Reason |
|---|---|---|
| Any specific LLM version string | Remove version; use "the primary inference model (Scout)" or "the evaluation judge (Maverick)" | Avoid version lock |
| `5 stress buckets` or `5 zones` | `five-zone HysteresisGate dead-band` | Consistent terminology |
| `ALS optimizer` or `ALS update` (as implemented) | append `(planned; not yet implemented)` | Accuracy |
| `Partial Trace` or `partial trace` (as implemented) | append `(planned; raises \texttt{NotImplementedError})` | Accuracy |
| `Tensorized LLM` (as implemented) | append `(planned; uses cloud API in current system)` | Accuracy |
| `cryptographic audit` (as implemented) | replace with `JSONL episode log` | Accuracy |
| bare `[X]` citation style | `\cite{key}` with key from `references.bib` | BibTeX |

---

## PART E -- Continuity Fixes

### E1 -- Transition: Background → Architecture

**Search anchor**: the last `\end{subsection}` or last sentence in the
Background section.

```latex
Having established the mathematical foundations, we now describe how the
HTN system integrates these components.
The physiological model (Sections~\ref{sec:background}.1--2) provides
the state signal; the MPS encodes it compactly
(Section~\ref{sec:background}.2); the MCTS plans over it
(Section~\ref{sec:background}.3); and the A3C trains the policy
end-to-end (Section~\ref{sec:background}.4).
The non-Hermitian formalism (Section~\ref{sec:background}.5) unifies
all dissipation effects into the single operator $\Gamma$
(Equation~\ref{eq:gamma}).
```

---

### E2 -- Transition: Architecture → Benchmarking

**Search anchor**: the last sentence of the Architecture section.

```latex
The architecture described above is evaluated empirically in
Section~\ref{sec:benchmarking} using an eight-arm capability ladder
designed to isolate the contribution of each component.
```

---

### E3 -- Related Work (inside Background section)

**Insert after** the Hysteresis in Psychology subsection.

```latex
\subsection{Related Work}
\label{sec:related}

Tensor network methods have been applied to supervised machine learning
by~\citet{stoudenmire2016supervised}, who demonstrated that MPS can
classify image data with competitive accuracy, establishing that tensor
decompositions are viable beyond physics.
Reinforcement learning for task-oriented dialogue was formalised by
\citet{kaelbling1998planning} using the POMDP framework that underlies
most dialogue planning systems.
The application of non-Hermitian operators to \emph{psychological}
state modelling is, to the best of our knowledge, novel to this work.
Prior approaches to physiological state modelling in mental health
companions have used rule-based thresholds~\cite{miller2012motivational}
or simple sliding-window averages; the OU process with hysteretic gating
provides a more principled dynamic model.
```

---

### E4 -- Conclusion section

**Insert after** the last section (Future Work / Discussion).

```latex
\section{Conclusion}
\label{sec:conclusion}

This paper has presented the Hysteretic Tensor Negotiation (HTN)
framework, a physiologically-aware architecture for mental health companion systems.
The key contributions are:
(1)~a non-Hermitian operator formulation unifying six physiological and
psychosocial dissipation channels into $\Gamma$ (Equation~\ref{eq:gamma});
(2)~an MPS-based physiological state encoding providing a fixed-size
longitudinal representation without KV-cache growth;
(3)~MCTS planning guided by an A3C actor-critic over a 22-action
clinical communication taxonomy; and
(4)~a three-layer care circle orchestration architecture in which each
user has a dedicated companion agent, companions communicate via
structured confidential channels, and multi-principal consent is
managed by two separated modules (\texttt{privacyGuard.js} and
\texttt{consentManager.js}).

Preliminary results from \texttt{run\_018} (8~arms, $\sim$500 episodes each)
show all physio-equipped arms exceeding the production rule-based baseline
by approximately 10~percentage points on episode completion rate, consistent
with the run\_013 pilot finding (11.6~pp on goal-achieved rate, OR~$\approx$~1.87).
Confirmatory analysis with per-episode judge scores and genuine metrics
(\texttt{change\_stage\_delta}, \texttt{stress\_auc}) is ongoing.
```

---

## Preamble additions required

Add to your `.tex` preamble if not already present:

```latex
\usepackage{pifont}          % \ding{51} checkmarks in tables
\usepackage{booktabs}        % \toprule, \midrule, \bottomrule
\usepackage{natbib}          % \citet, \citep author-year citations
\bibliographystyle{plainnat} % or apalike / ieeetr
\bibliography{references}    % at end of document (references.bib)
```

---

*End of insertion guide.*
*New content added: Background section (B1), Care Circle subsection (B2),*
*Empirical Benchmarking section (B3, replacing empty §5),*
*Implementation Status table (B4), 8 figures, Related Work, Conclusion.*
*Corrections applied: A1--A8 (M\_trunc, ALS, partial trace, Tensorized LLM,*
*cryptographic audit, Gamma, stress index, action count).*
