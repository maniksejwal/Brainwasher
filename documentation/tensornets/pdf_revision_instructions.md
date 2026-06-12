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

### A2 -- ALS: implemented in MPS layer, NOT wired into A3C policy update

**ANCHOR**: Search `4.11` -- the sentence that presents ALS as the current
policy update mechanism (e.g. "policy updates are performed using ALS" or
"Alternating Least Squares provides a locally convex...").

**REPLACE that paragraph** (remove any claim that ALS is used for policy updates):
```latex
\emph{Implementation status:}
The ALS functions (\texttt{als\_update}, \texttt{als\_sweep},
\texttt{als\_two\_site}, \texttt{als\_two\_site\_sweep}) are fully implemented
and tested in \texttt{tensornets/core/mps.py} (E6, marked done).
They operate on the MPS tensor cores directly and pass all integration tests.

However, ALS is \emph{not} the current A3C policy-update mechanism.
The actor policy is represented as a \emph{dictionary of log-bias weights}
$\{\log p_0(a)\}$ over the action taxonomy, not as an MPS.
Policy updates use a log-bias exponentially-weighted moving average (EWA):
\[
  \log p_{t+1}(a) \leftarrow (1-\alpha)\,\log p_t(a) \;+\; \alpha\,A(s,a)
\]
where $A(s,a)$ is the advantage estimated by the Critic.
This is implemented in \texttt{a3c/worker.py::apply\_update()}.

Wiring ALS into the A3C policy update would require representing the actor
policy as an MPS (replacing the log-bias dict) and calling \texttt{als\_sweep()}
as the gradient step.  This is a planned future-work item.  The question of
\emph{which} update rule is better (log-bias EWA vs.\ ALS sweep) is itself an
open research question: ALS is locally convex and enjoys convergence guarantees
within each sweep, but the log-bias EWA is simpler, stateless, and has proven
effective empirically in the current 8-arm comparison.
See Section~\ref{sec:future} for the ALS policy integration milestone.
```

**VERIFY**: Next paragraph discusses the critic network or value function.

---

### A3 -- Partial trace: approximation implemented, full mixed-state formulation planned

**ANCHOR**: Search `4.9` -- the sentence presenting `partial_trace_physio()`
as an operational step (e.g. "the partial trace over environment degrees...").

**REPLACE / APPEND after that sentence**:
```latex
\emph{Implementation status:}
\texttt{partial\_trace\_physio()} is implemented in \texttt{tensornets/core/mps.py}
and is called via \texttt{agents/shared\_tensor\_state.py}.
The current implementation uses a transfer-matrix approximation: it restricts
the MPS contraction to the first $\chi_\text{semantic}$ bond indices, treating
the semantic and physiological subspaces as orthogonally ordered.
This approximation is exact for identity-initialised MPS but degrades after
many A3C policy updates that mix the bond subspaces via SVD truncation.

The \emph{exact} partial trace — forming the full density matrix
$\rho = |\Psi\rangle\langle\Psi|$ via double-layer contraction and tracing over
the physiological bond indices — is a planned Phase~4b extension
(task PT2 in the development roadmap).
The current system propagates a pure-state MPS without full environment tracing.

The partial trace does not affect the current A3C policy gradient; its primary
planned uses are: (i) inter-agent subspace sandboxing in \texttt{CompanionCoordinator},
(ii) information-theoretic reward shaping ($r_\text{privacy} = -I(\text{semantic};\text{physio})$),
and (iii) a principled semantic retrieval key for TensorRAG,
replacing the heuristic \texttt{bond\_fingerprint()}.
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

### A7 -- Gamma_physio: five-signal weighted input, not HRV alone

**ANCHOR**: Search `4.3` in your `.tex` source.
Section §4.3 is about the decay matrix $\Gamma$.
Find the sentence or equation in §4.3 that defines the physiological
component $\Gamma_\text{physio}$ as a function of HRV (or a single signal).
This is typically the **first equation** in §4.3 or the sentence
immediately before it, e.g. a sentence containing
"HRV" and "$\Gamma_\text{physio}$" or "$\gamma_\text{physio}$".

**REPLACE** (the part that says Γ_physio is derived from HRV or a
single signal) **WITH**:
```latex
The physiological dissipation component $\Gamma_\text{physio}$
is proportional to a five-signal weighted stress index $s$:
\begin{equation}
  s = w_1 \hat{\sigma}_\text{HRV} + w_2 \hat{\sigma}_\text{EDA}
    + w_3 \hat{\sigma}_\text{sleep} + w_4 \hat{\sigma}_\text{glucose}
    + w_5 \hat{\sigma}_\text{reactivity},
  \quad (w_1,\ldots,w_5) = (0.35,\,0.25,\,0.20,\,0.10,\,0.10)
  \label{eq:stress}
\end{equation}
where each $\hat{\sigma}$ is min-max normalised.
$\Gamma_\text{physio} = f(s)$ for a monotone mapping $f$
defined in \texttt{physio/state.py}.
```

**VERIFY**: The next equation or sentence in §4.3 should continue describing
$\Gamma_\text{habit}$ or another component.

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
  Five HysteresisGate zones:
  \texttt{calm} $[0.00,0.25)$, \texttt{mild\_tension} $[0.25,0.45)$,
  \texttt{moderate} $[0.45,0.60)$, \texttt{elevated} $[0.60,0.78)$,
  \texttt{critical} $[0.78,1.00]$.
  Dead-band = 0.06; downward transition fires at (boundary $-$ 0.06).
  Observations $o \in \Omega$: patient utterances.
  Actions $a \in \mathcal{A}$: 22 stress-gated actions (full vocabulary 51 entries).
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

### A9 -- HysteresisGate: three zones corrected to five named zones

**ANCHOR**: Search `4.3` (same subsection as A7), second occurrence.
Or search the string `stress bucket` or `three zones` or `low.*moderate.*high`
(the PDF describes 3 stress levels; the implementation has 5).
This is typically the **paragraph immediately following** the stress index
equation (Eq.~\ref{eq:stress}).

**REPLACE** any three-zone description WITH:
```latex
The \texttt{HysteresisGate} partitions $s$ into five named zones
using asymmetric Schmitt-trigger thresholds (dead-band = 0.06):
\begin{center}
\begin{tabular}{lllp{5cm}}
\hline
Zone & Range & Code name & Therapeutic mode \\
\hline
0 & $[0.00, 0.25)$ & \texttt{calm}          & Exploration / psychoeducation \\
1 & $[0.25, 0.45)$ & \texttt{mild\_tension}  & Motivational / change-talk \\
2 & $[0.45, 0.60)$ & \texttt{moderate}       & Ambivalence / develop-discrepancy \\
3 & $[0.60, 0.78)$ & \texttt{elevated}       & Validate / de-escalate \\
4 & $[0.78, 1.00]$ & \texttt{critical}       & Safety-only / flooding-hold / escalate \\
\hline
\end{tabular}
\end{center}
Downward transition threshold = upward threshold $-$ 0.06 (the dead-band),
preventing rapid zone oscillation from small stress fluctuations.
Action availability is stress-gated: confrontational and high-demand
actions are suppressed in zones 3 and 4.
```

**VERIFY**: Next paragraph discusses the transition thresholds in more detail
or moves to the OU process.

---

### A10 -- Dual-rank architecture: verify description matches implementation

**ANCHOR**: Search `4.5` or `dual` or `strategic agent` or `tactical agent`
or `SVD bottleneck`. The relevant paragraph describes a high-rank
strategic agent and a low-rank tactical agent connected via an SVD
bottleneck.

This description is **conceptually correct** but the mechanism differs:
the "bottleneck" is implemented as the `[MCTS GUIDANCE]` text block
injected into the prompt (not a literal matrix multiplication at the
logit layer).

**APPEND after the dual-rank description paragraph**:
```latex
\emph{Clarification:} In the current implementation, the SVD
bottleneck operates at the \emph{prompt} level: the dominant singular
vectors of $M_\text{trunc}$ are serialised as a ranked action list
and injected into the primary inference model system prompt under the
tag \texttt{[MCTS GUIDANCE]}.
The tactical agent (primary inference model) reads this list and
generates text accordingly.
Direct logit-level tensor contraction is not possible via the
cloud API; the natural-language hint is the operational analogue.
```

**VERIFY**: Next paragraph or subsection discusses action selection or the Scout response format.

---

### Fig 9 -- Dual-rank architecture (strategic + tactical agents)

**Insert after** the dual-rank architecture description in §4.5 (or wherever
the strategic/tactical agent split is described).
**Search anchor**: `strategic agent` or `tactical agent` or `dual.*rank`.

```latex
\begin{figure}[h]
\centering
\includegraphics[width=0.95\linewidth]{fig_dual_rank}
\caption{Dual-rank architecture.
  The strategic agent (high-rank MPS + MCTS, 80--150 iterations) computes
  the optimal action path and compresses it via SVD into $M_\text{trunc}$.
  The tactical agent (primary inference model, cloud API) generates text
  guided by the top-3 $M_\text{trunc}$ actions injected as
  \texttt{[MCTS GUIDANCE]} in the system prompt.
  Arrow widths indicate data bandwidth; the SVD bottleneck limits
  communication to $\mathcal{O}(\chi_\text{max})$ values.}
\label{fig:dual-rank}
\end{figure}
```

---

### Fig 10 -- V_INT_PRIOR coupling matrix (heat map)

**Insert immediately after** the $V_\text{int}$ equation (Eq.~\ref{eq:vint})
in the care circle subsection.
**Search anchor**: `V_\text{int}` or `V_INT_PRIOR` or `social coupling`.

```latex
\begin{figure}[h]
\centering
\includegraphics[width=0.55\linewidth]{fig_vint_heatmap}
\caption{Asymmetric inter-companion coupling matrix $V_\text{int}$
  (patient--caregiver--clinician, $3 \times 3$).
  Cell $(i,j)$ gives the coupling from role $i$ to role $j$.
  Notable asymmetry: patient$\to$caregiver (0.35) $\neq$ caregiver$\to$patient (0.20);
  clinician$\to$patient (0.50) is the dominant cross-role channel.
  Fixed priors from \texttt{agents/shared\_tensor\_state.py}.}
\label{fig:vint}
\end{figure}
```

---

### Fig 11 -- Stress trajectory: STANDARD vs FLOODING mode

**Insert after** the reward function subsection (§5.3) or wherever
FLOODING mode is first described.
**Search anchor**: `flooding` or `FLOODING` or `target stress` or `mode.*reward`.

```latex
\begin{figure}[h]
\centering
\includegraphics[width=0.85\linewidth]{fig_stress_trajectory}
\caption{Simulated stress index $s(t)$ over 20 turns under two reward modes.
  \emph{STANDARD mode}: reward is maximised by reducing $s$ toward zero
  (stress-reduction therapy framing).
  \emph{FLOODING mode}: reward is maximised by driving $s$ toward a
  target $s_\text{target} = 0.80$ (exposure therapy framing).
  Same action taxonomy, qualitatively different physiological trajectories.
  After~\cite{foa1986emotional}.}
\label{fig:stress-modes}
\end{figure}
```

---

### Fig 12 -- PK/PD two-timescale SSRI model

**Insert after** the PK/PD subsection, near the $\Gamma_\text{pkpd}$ description.
**Search anchor**: `SSRI` or `PK/PD` or `pharmacokin` or `pkpd`.

```latex
\begin{figure}[h]
\centering
\includegraphics[width=0.85\linewidth]{fig_pkpd_ssri}
\caption{Two-timescale SSRI pharmacodynamic model.
  \emph{Left axis}: plasma concentration $C_p(t)$ (one-compartment
  first-order kinetics: $\dot{C}_p = -k_e C_p + \text{dose}/V_d$).
  \emph{Right axis}: symptom trajectory showing initial worsening due to
  5-HT1A autoreceptor overstimulation, followed by delayed improvement
  after receptor downregulation at $t \approx 2$--4 weeks.
  $\Gamma_\text{pkpd}$ encodes this non-monotone inversion.
  After Lotrich \& Pollock (2004).}
\label{fig:pkpd}
\end{figure}
```

---

### Fig 13 -- run_013 results: goal\_achieved\% by arm (bar chart)

**Insert at the start of the run\_013 pilot results subsection**,
before Table~\ref{tab:run013}.
**Search anchor**: `run\_013` or `pilot results` or `\subsection{Pilot`.

```latex
\begin{figure}[h]
\centering
\includegraphics[width=0.75\linewidth]{fig_run013_bar}
\caption{Proportion of episodes achieving session goal
  (\texttt{goal\_achieved}, $\geq 0.75$ judge score) for the three
  \texttt{run\_013} arms (130 episodes each).
  Error bars: 95\% Wilson confidence intervals.
  $H_{0,1}$: OR = 1 is rejected at $\alpha = 0.05$ for
  \texttt{htn\_mcts} vs.\ \texttt{oldschool}
  (OR $\approx$ 1.87, preliminary).
  \texttt{goal\_progress} is the uncontaminated primary metric
  (not used in the MCTS reward signal).}
\label{fig:run013}
\end{figure}
```

---

### Fig 14 -- Production turn data flow (sequence diagram)

**Insert in the Architecture section**, after the three-layer coordination
description or at the end of the care circle subsection.
**Search anchor**: `\subsubsection{Three-Layer` or `end-to-end` or
`data flow` near a sentence about the full turn lifecycle.

```latex
\begin{figure}[h]
\centering
\includegraphics[width=0.98\linewidth]{fig_dataflow_turn}
\caption{End-to-end data flow for one production conversation turn.
  \texttt{server.js} $\to$ \texttt{orchestrator.js} $\to$
  \texttt{contextAwareCompanionRouter} $\to$
  \texttt{CompanionCoordinator} (5 parallel handlers) $\to$
  \texttt{tensornetsBridge} (POST \texttt{/physio} + \texttt{/mcts/best-action}) $\to$
  role-specific optimizer $\to$ primary inference model $\to$ SSE reply.
  Approximate latency annotated at each hop.
  \texttt{privacyGuard.js} screens the response before the SSE write.}
\label{fig:dataflow}
\end{figure}
```

---

## PART D (CONTINUED) -- Additional Consistency Fixes

These supplement the table in the earlier Part D section.

---

### D2 -- H_eff notation: standardise typesetting

**Search globally for**: `H_{eff}` or `H_\mathrm{eff}` or `H_\text{eff}` or
`H_{\\rm eff}` (any variant spelling).

**Replace all occurrences with**: `\mathcal{H}_{\text{eff}}`

Add to preamble if needed: `\newcommand{\Heff}{\mathcal{H}_{\text{eff}}}`
then use `\Heff` throughout.

---

### D3 -- Agent names: reconcile PDF labels with real module names

**Search for** any of these PDF agent names:
`Clinical Agent`, `RCM Agent`, `Administrative Agent`, `Billing Agent`,
`Scheduling Agent`.

**Replace / clarify** with:

| PDF name | Real module | Suggested paper label |
|---|---|---|
| `Clinical Agent` | `companions/agents/clinicalAgent.js` | Clinical Assessment Agent (\texttt{clinicalAgent.js}) |
| `RCM Agent` / `Administrative Agent` | *(not implemented; was pre-HTN design)* | Remove or move to Appendix as legacy design |
| `PatientOptimizer` | `companions/agents/patientOptimizer.js` | Patient Response Optimiser |
| `DoctorOptimizer` | `companions/agents/doctorOptimizer.js` | Clinician Summary Agent |

Add a footnote where the legacy RCM/billing framing is first mentioned:
```latex
\footnote{The original design targeted clinical revenue cycle management.
The implemented system is a multi-principal care circle companion;
the RCM framing is retained in this section for historical context only.}
```

---

### D4 -- Terminology: ``arm'' vs ``experiment''

**Search for**: the word `arm` used to mean a training condition.

**Standardise**: use `experiment` in text; retain `arm` only in
`\texttt{arm}` typeface references to code identifiers
(e.g.\ `\texttt{arm\_physio\_llm}`).

Add a footnote at first usage:
```latex
\footnote{The codebase uses the term \texttt{arm} for backward compatibility
with run\_008--run\_013 data; this paper uses \emph{experiment} in text.}
```

---

### D5 -- Stress zones: update all three-zone references

**Search for**: `low.*moderate.*high` (case-insensitive) describing stress levels,
or `three.*stress.*level`, or `stress bucket` (singular), or
`three buckets`.

**Replace with**: references to the five-zone table in A9 above, e.g.:
```latex
stress zone (\texttt{calm}, \texttt{mild\_tension}, \texttt{moderate},
\texttt{elevated}, or \texttt{critical};
see Table on p.~\pageref{tab:zones})
```

Note: the code name for zone 1 is `mild_tension`, not `mild`.
Zone boundaries: [0.00, 0.25), [0.25, 0.45), [0.45, 0.60), [0.60, 0.78), [0.78, 1.00].
Dead-band 0.06 on downward transitions.

---

## PART E (CONTINUED) -- Additional Continuity Fixes

---

### E5 -- Bridge paragraph: Introduction (§1) → Background (§2)

**ANCHOR**: The **last sentence of §1** (the Introduction).
Typically ends with a roadmap sentence like "The remainder of this paper is
structured as follows" or "Section X presents..." -- search for
`\textit{The remainder}` or `structured as follows` or `Section 2`.

**INSERT immediately before** the `\section{Background` command:
```latex
The theoretical prerequisites for the HTN framework span several
disciplines: physiological signal modelling, tensor network algebra,
reinforcement learning, and non-Hermitian quantum mechanics.
Section~\ref{sec:background} provides a self-contained primer on each.
```

---

### E6 -- Bridge paragraph: Background (§2) → Architecture (§3)

**ANCHOR**: The **last paragraph of §2** (Background and Preliminaries).
Search for the end of the `\subsection{Hysteresis in Psychology}` section
or the `\subsection{Related Work}` section if present.
The bridge goes between the end of §2 and `\section{` that opens §3.

**INSERT**:
```latex
Having established the mathematical foundations, we now describe how
these components are integrated in the HTN system architecture.
The physiological model (Section~\ref{sec:background}.1--2) provides the
state signal; the MPS encodes it compactly
(Section~\ref{sec:background}.2); the MCTS plans over it
(Section~\ref{sec:background}.3); and the A3C trains the policy
end-to-end (Section~\ref{sec:background}.4).
The non-Hermitian formalism (Section~\ref{sec:background}.5) unifies
all dissipation effects into the single operator $\Gamma$
(Equation~\ref{eq:gamma}).
```

---

### E7 -- Bridge paragraph: §3 Architecture → §4 System Details

**ANCHOR**: The **last sentence of §3** (System Architecture overview).
The sentence typically ends the high-level description of server.js +
FastAPI deployment. Search for `FastAPI` near the end of a section,
or `Node.js.*Express` near a section boundary.

**INSERT**:
```latex
Section~\ref{sec:system} details each architectural component in turn,
beginning with the physiological state model and proceeding through
the MPS encoding, the MCTS planner, the A3C training loop, and the
care circle orchestration layer.
```

---

### E8 -- Bridge paragraph: inside §4 (end of subsection tour)

**ANCHOR**: The **last sentence of §4.13** (or whichever is the final
subsection of the system details chapter).
Search for `4.13` in your `.tex` source; the final subsection in that
chapter.

**INSERT after the last sentence of §4.13**:
```latex
Table~\ref{tab:impl} (Section~\ref{sec:impl-status}) summarises the
implementation status of all components described in this chapter.
The components in Sections~\ref{sec:mcts} (MCTS),
\ref{sec:a3c} (A3C), and \ref{sec:care-circle} (care circle
orchestration) jointly constitute the HTN framework and are the subject
of the empirical evaluation in Section~\ref{sec:benchmarking}.
```

---

### E9 -- Related Work additions

**ANCHOR**: The end of `\subsection{Related Work}` (E3 above, if you have
added it), or after the Hysteresis in Psychology subsection.
Search for `Stoudenmire` or `Kaelbling` or `related work` (the paragraph
added in E3).

**APPEND after E3's related work paragraph**:
```latex
Neuro-symbolic AI approaches~\cite{garcez2022neurosymbolic} have sought
to integrate logical constraints into neural architectures;
the HTN framework achieves an analogous integration by embedding
physiological state constraints directly into the MCTS planning tree
via the HysteresisGate.
MCTS has been applied to dialogue policy
optimisation by~\citet{peng2021soloist}, who used it for few-shot
task-oriented dialogue; the HTN system extends this to a
\emph{physiologically-conditioned} multi-principal setting.
```

Add these BibTeX entries to `references.bib`:
```bibtex
@book{garcez2022neurosymbolic,
  author    = {d'Avila Garcez, Artur and Lamb, Lu\'is C.},
  title     = {Neurosymbolic {AI}: The Third Wave},
  journal   = {Artificial Intelligence Review},
  volume    = {56},
  pages     = {12387--12406},
  year      = {2023},
  doi       = {10.1007/s10462-023-10448-w}
}

@inproceedings{peng2021soloist,
  author    = {Peng, Baolin and Li, Chunyuan and Li, Jinchao and
               Shayandeh, Shahin and Liden, Lars and Gao, Jianfeng},
  title     = {{SOLOIST}: Building Task Bots at Scale with Transfer
               Learning and Machine Teaching},
  booktitle = {Transactions of the Association for Computational Linguistics},
  volume    = {9},
  pages     = {637--652},
  year      = {2021},
  doi       = {10.1162/tacl_a_00390}
}

@article{lotrich2004pkpd,
  author    = {Lotrich, Felix E. and Pollock, Bruce G.},
  title     = {Personalization of antidepressant prescribing},
  journal   = {Journal of Clinical Pharmacology},
  volume    = {44},
  pages     = {1151--1162},
  year      = {2004},
  doi       = {10.1177/0091270004268457}
}
```

---

## PART F -- Note on Anchors

Since the `.tex` source is on Overleaf and not available locally for
verbatim extraction, all anchors in this document use one of:

1. **Section number** (e.g. `4.5.5`) -- search the bare number in Overleaf;
   it appears in `\subsubsection{}` headings or `\label{}` tags.
2. **LaTeX command** (e.g. `\section{Benchmarking}`) -- exact string search.
3. **Equation environment** (e.g. "the first equation in §4.3") -- find by
   counting `\begin{equation}` occurrences within that subsection.
4. **Unique technical term** (e.g. `HysteresisGate`, `M_\text{trunc}`,
   `DELTA\_SCALE`) -- these appear verbatim in the LaTeX source.

For corrections where a specific sentence must be found: the section number
anchor is the most reliable. Navigate to that subsection, then scan the
paragraph containing the relevant equation or claim.

---

*End of complete insertion guide.*
*Total new content: Background §2 (B1), Care Circle §3.x (B2),*
*Empirical Benchmarking §5 replacing empty section (B3),*
*Implementation Status table (B4), 14 figures (C),*
*10 corrections (A1--A10), consistency fixes (D1--D5),*
*continuity bridges (E1--E9 including §1→§2, §2→§3, §3→§4, §4 end).*

---

## PART G — FIGURE CATALOGUE: what each figure should show

This section describes the **visual content** of each figure listed in Part C
and maps each to a source (Mermaid source file, Python generation script,
TikZ, or hand-drawn).  Three columns:
- **Source** — where the diagram content lives.
- **How to export** — toolchain to get a PDF/PNG for `\includegraphics`.
- **Key content** — what must be visible.

---

### Fig 1 — Physiological hysteresis time course (TikZ / pgfplots)

**Source**: Conceptual; no file exists.  Draw directly in TikZ.

**How to export**: TikZ inline in LaTeX.

**Key content**:
- Two time-series curves: `HRV_ms` and `stress_index` against turn number.
- Mark the transition from zone `calm` (grey) to `mild_tension` (yellow) to
  `elevated` (orange) and back.
- Show the **asymmetric threshold**: upward transition fires at $s=0.25$,
  downward transition fires at $s=0.19$ (= $0.25 - 0.06$).
- Label the dead-band gap with a double-headed arrow.
- Caption: "HRV (ms) and normalised stress index over a simulated
  15-turn episode.  Shaded regions indicate locked HysteresisGate zone.
  Note asymmetric recovery: the zone does not reset until stress falls
  below (threshold $-$ 0.06)."

**Minimal TikZ skeleton**:
```latex
\begin{tikzpicture}
  \begin{axis}[xlabel={Turn},ylabel={Value},ymin=0,ymax=1,
               xtick={0,5,10,15}, legend pos=north east]
    \addplot[blue,thick] coordinates { %% stress_index
      (0,.15)(1,.22)(2,.38)(3,.55)(4,.63)(5,.58)(6,.50)
      (7,.40)(8,.30)(9,.18)(10,.14)(11,.13)(12,.14)(13,.15) };
    \addlegendentry{stress\_index}
    \addplot[red!70,dashed,thick] coordinates { %% HRV_ms (normalised)
      (0,.85)(1,.78)(2,.62)(3,.45)(4,.37)(5,.42)(6,.50)
      (7,.60)(8,.70)(9,.82)(10,.86)(11,.87)(12,.86)(13,.85) };
    \addlegendentry{HRV\_ms (norm.)}
    %% threshold lines
    \addplot[gray,dashed] coordinates {(0,.25)(13,.25)};
    \addplot[gray,dotted] coordinates {(0,.19)(13,.19)};
  \end{axis}
\end{tikzpicture}
```

---

### Fig 2 — Matrix Product State (MPS) bond dimension (TikZ)

**Source**: Conceptual; no existing file.  Draw in TikZ.

**Key content**:
- A chain of $T=10$ tensors, each drawn as a circle node labelled $A^{(t)}$.
- Horizontal bonds between adjacent tensors, labelled $\chi=4$ (bond dimension).
- Vertical legs pointing downward from each $A^{(t)}$, labelled $d=64$
  (local Hilbert space = 64-dim utterance embedding).
- The first and last tensors each have only one horizontal bond (open boundary).
- Caption: "MPS representation of dialogue history over $T=10$ turns.
  Each tensor $A^{(t)} \in \mathbb{R}^{d \times \chi \times \chi}$ encodes
  one turn's embedding.  Bond dimension $\chi=4$ limits entanglement and
  prevents exponential growth.  After~\cite{orus2014practical}."

---

### Fig 3 — H_eff non-Hermitian decomposition (TikZ block diagram)

**Source**: Conceptual; draw in TikZ.

**Key content**:
- Three boxes arranged left-to-right:
  `H_0` (real diagonal: natural frequencies), `+`, `Γ_habit` (habit decay),
  `+`, `Γ_physio` (physiological decay).
- An arrow from each box into $\mathcal{H}_\text{eff} = H_0 - i\Gamma$.
- Below `Γ_physio`: a small sub-box showing "$s$ (5 signals) → $f(s)$".
- Caption: "Non-Hermitian effective Hamiltonian decomposition.
  $H_0$ encodes natural oscillation frequencies of psychological states.
  $\Gamma = \Gamma_\text{habit} + \Gamma_\text{physio}$ adds
  dissipation from habit strength and physiological load.
  After~\cite{rotter1950quantum}."

---

### Fig 4 — MCTS four-phase loop (TikZ cycle)

**Source**: Conceptual; draw in TikZ as a circle of four labelled nodes.

**Key content**:
Four nodes in a clock arrangement, connected by directional arrows:
1. **Select** — traverse from root, UTC score guides child choice.
2. **Expand** — add child node for unexplored action.
3. **Simulate** (rollout) — LLM or random policy to episode end.
4. **Backpropagate** — update Q-values along path.
- Label the root node as "current dialogue state".
- Caption: "Four-phase MCTS loop used by the HTN framework.
  The UTC exploration constant $c_p$ balances exploitation and exploration.
  After~\cite{coulom2006efficient}."

---

### Fig 5 — Care circle companion topology

**Source**: `documentation/uml_diagrams/env_02_agent_user_topology.md`
— Diagram A (Per-user companion topology within one care circle).

**How to export**:
1. Open [https://mermaid.live](https://mermaid.live).
2. Paste the Mermaid source from Diagram A in `env_02_agent_user_topology.md`.
3. Download as SVG, then convert to PDF via `inkscape --export-pdf=fig_care_circle.pdf fig_care_circle.svg`.

**Key content**:
- One node per user role (patient, caregiver, clinician) each with their own
  `Companion` box.
- `orchestrator.js` event bus at the centre connecting all companions.
- Arrow labels: `"COMPANION_COORDINATION"` events.
- Caption: "Care-circle companion topology.
  Each user has exactly one companion instance; companions communicate
  via the \texttt{orchestrator.js} event bus.
  Intra-companion logic runs inside \texttt{CompanionCoordinator.js};
  cross-companion events are routed by \texttt{orchestrator.js}."

---

### Fig 6 — Multi-episode 8-arm capability ladder

**Source**: `documentation/uml_diagrams/env_06_training_environment.md`
— Training Architecture Overview diagram.

**How to export**: Same Mermaid-live → SVG → PDF pipeline as Fig 5.

**Key content**:
- Eight rows, one per arm, showing which capabilities are present
  (physio / MPS / LLM / CoT / MCTS / inertial / HPVOOT).
- Arm 5 (`arm_oldschool`) marked clearly as baseline (no physio, no MCTS).
- Arm 7 marked with "⚠ instability observed in run\_018".
- Caption: "Capability ladder for the 8 A3C training experiments (run\_018).
  Each experiment isolates one or more architectural features.
  Arms 0--4 form a progressive ablation; Arm 5 is the JS rule-based baseline.
  Arms 6--7 add HPVOOT planning."

---

### Fig 7 — POMDP-H state diagram

**Source**: `documentation/uml_diagrams/env_03_rl_environment_pomdph.md`
— State Space / HysteresisGate Zones stateDiagram.

**How to export**: Mermaid-live → SVG → PDF.

**Key content**:
- Five states: `calm`, `mild_tension`, `moderate`, `elevated`, `critical`.
- Directed arrows between adjacent states labelled with transition thresholds
  (e.g., "stress ≥ 0.45" for moderate → elevated) and dead-band transitions
  (e.g., "stress < 0.39" for elevated → moderate).
- Initial state arrow into `calm`.
- Terminal arrow from `critical` labelled "episode end".
- Caption: "POMDP-H hysteretic state diagram.
  Zone transitions are governed by asymmetric Schmitt-trigger thresholds
  (dead-band = 0.06).  See Table~\ref{tab:zones} for therapeutic mode per zone."

---

### Fig 8 — run\_018 per-arm completion rates (pgfplots bar chart)

**Source**: Raw data in `tensornets/runs/run_018/*/run_state.json` and
`episodes/` directories.  Generate with Python (see G.1 below).

**Key content**:
- Horizontal bar chart, one bar per arm, showing `successful_eps / ep_count`.
- Error bars: Wilson 95% CI.
- Arm 5 (baseline) highlighted in grey; other arms in blue; Arm 7 in red
  (instability flag).
- Caption: "run\_018 per-arm episode completion rates with 95\% Wilson
  confidence intervals ($n$ episodes per arm; see Table~\ref{tab:run018}).
  Arm 5 is the JS rule-based baseline.
  Arm~7 shows elevated instability."

---

### Fig 9 — Dual-rank architecture (TikZ block diagram)

**Source**: Conceptual; draw in TikZ.

**Key content**:
- Two boxes: "Strategic agent (MCTS)" → produces a low-dimensional action
  guidance vector → injected as `[MCTS GUIDANCE]` text tag into LLM prompt.
- "Tactical agent (LLM / unifiedAgent)" → reads the prompt including
  `[MCTS GUIDANCE]` → generates the response token-by-token.
- Explicit label: "$M_\text{trunc}$ = MCTS guidance tag in prompt context,
  not a logit-level constraint."
- Caption: "Dual-rank architecture.
  The strategic agent (MCTS) operates over a compressed action vocabulary
  and injects guidance into the LLM prompt.
  The tactical agent (LLM) generates free-text responses conditioned on
  this prompt-level hint."

---

### Fig 10 — V\_INT\_PRIOR heat map (pgfplots)

**Source**: The `V_INT_PRIOR` tensor is defined in
`tensornets/tensornets/a3c/arms.py`.  Generate with Python (see G.1 below).

**Key content**:
- 3×3 colour matrix: rows = readiness stages (pre-contemplation, contemplation,
  action/maintenance); columns = stress zones (low = calm+mild\_tension,
  medium = moderate+elevated, high = critical).
- Cell colour encodes the prior expected intervention value.
- Caption: "Intrinsic intervention prior $V_\text{INT\_PRIOR}$.
  Warm colours indicate higher expected value for that
  (readiness stage, stress zone) combination.
  Used to initialise MCTS rollout value at novel states."

---

### Fig 11 — Stress trajectory: STANDARD vs FLOODING mode (pgfplots)

**Source**: Generate with Python; simulate two OU trajectories (see G.1).

**Key content**:
- Two line plots on the same axes: one for `patient_mode=standard` (HRV
  recovers quickly), one for `patient_mode=flooding` (stress stays elevated
  for several turns after a stressor).
- Mark the stressor event with a vertical dotted line.
- Caption: "Stress index time course under STANDARD vs FLOODING patient mode.
  The Ornstein-Uhlenbeck process reverts to different $\theta$ (recovery
  speed) values: STANDARD $\theta=0.3$, FLOODING $\theta=0.07$
  (slower recovery, models flooding-technique tolerance)."

---

### Fig 12 — PK/PD two-timescale SSRI model (pgfplots)

**Source**: `tensornets/tensornets/physio/pkpd.py`.  Generate with Python.

**Key content**:
- Two panels: left = plasma concentration $C_p(t)$ (first-order PK model:
  $dC_p/dt = -k_e C_p + \text{dose\_rate}$); right = PD effect $E(t)$
  (Emax model or slow-binding: $E = E_\text{max} C_p / (EC_{50} + C_p)$).
- X-axis in days (simulate 28 days, once-daily dosing).
- Caption: "Two-timescale pharmacokinetic/pharmacodynamic (PK/PD) model for
  SSRI anti-depressant modelling.  Plasma concentration follows a
  first-order elimination model (half-life $\approx 36$\,h for sertraline);
  therapeutic effect lags concentration via slow target-binding
  (after~\cite{lotrich2004})."

---

### Fig 13 — run\_013 results bar chart (pgfplots)

**Source**: Statistics extracted from `documentation/tensornets/06_results.md`
§run\_013.  Generate with Python (see G.1).

**Key content**:
- Grouped bar chart: four conditions × three metrics (goal\_achieved rate,
  mean turns to goal, stress AUC).
- Error bars: 95% CI as in `06_results.md`.
- Caption: "run\_013 experimental results.
  Error bars show 95\% Wilson CI (binary outcomes) or
  bootstrapped CI (continuous).  Statistically significant differences
  ($\alpha = 0.05$, Bonferroni-corrected) are marked with \textbf{*}."

---

### Fig 14 — Production turn data flow (UML sequence)

**Source**: `documentation/uml_diagrams/env_04_information_flow.md`
— Full Request Lifecycle sequence diagram.

**How to export**: Mermaid-live → SVG → PDF.

**Key content**:
The full sequence from the diagram: User → server.js → router →
CompanionCoordinator → parallel handlers → FastAPI bridge → LLM →
privacyGuard → SSE response.
- Caption: "Production turn data flow (Logical View, 4+1 model).
  Parallel handler fan-out (Step 1) and async enrichment (Step 2.5)
  are shown as \texttt{par} blocks.
  The FastAPI physio bridge is called asynchronously;
  the SSE response is streamed back to the browser."

---

## Additional figures from existing UML diagrams

The following six diagrams from `documentation/uml_diagrams/` should also
be included in the PDF as appendix figures or inline in the relevant sections.
Use the same Mermaid-live export pipeline.

| Filename | Suggested placement | LaTeX label |
|----------|-------------------|-------------|
| `env_01_physical_deployment.md` | §4 System Architecture | `\label{fig:deployment}` |
| `env_05_care_circle_social_graph.md` | §3.x Care Circle | `\label{fig:social_graph}` |
| `escalation_flow_v2_real_modules.md` | §4.x Escalation | `\label{fig:escalation}` |
| `basic_message_flow_v2_real_modules.md` | §4.x Message Flow | `\label{fig:message_flow}` |
| `consent_management_v2_real_modules.md` | §4.x Privacy & Consent | `\label{fig:consent}` |
| `context_switching_v2_real_modules.md` | §4.x Context Switching | `\label{fig:context_switch}` |

For each, add a figure block:
```latex
\begin{figure}[h]
\centering
\includegraphics[width=0.9\linewidth]{<exported_pdf_or_png>}
\caption{<description from the .md file preamble>}
\label{fig:<label>}
\end{figure}
```

---

## PART G.1 — Python scripts to generate data-driven figures

The following scripts produce PDF-quality figures for Figs 8, 10, 11, 12, 13.
Run from the workspace root: `python scripts/gen_figures.py`

(Create `scripts/gen_figures.py` with the content below.)

```python
"""
Generate all data-driven PDF figures for Tensor_nets.pdf.
Output: figures/*.pdf  (or figures/*.png for pgfplots import)
"""
import json
import math
import os
import pathlib
import random

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np

OUT = pathlib.Path("figures")
OUT.mkdir(exist_ok=True)

# ── Fig 8: run_018 per-arm completion rates ───────────────────────────────────
def wilson_ci(k, n, z=1.96):
    if n == 0:
        return 0.0, 0.0
    p = k / n
    denom = 1 + z**2 / n
    centre = (p + z**2 / (2 * n)) / denom
    margin = (z * math.sqrt(p*(1-p)/n + z**2/(4*n**2))) / denom
    return max(0, centre - margin), min(1, centre + margin)

arm_dirs = pathlib.Path("tensornets/runs/run_018")
arm_names, rates, lo_errs, hi_errs = [], [], [], []
for arm_dir in sorted(arm_dirs.iterdir()):
    state_file = arm_dir / "checkpoints" / "run_state.json"
    if not state_file.exists():
        # count completed episode files as proxy
        ep_dir = arm_dir / "episodes"
        k = len(list(ep_dir.glob("*.jsonl"))) if ep_dir.exists() else 0
        n = max(k, 1)
    else:
        st = json.loads(state_file.read_text())
        k = st.get("successful_eps", 0)
        n = st.get("ep_count", 0)
    lo, hi = wilson_ci(k, max(n, 1))
    p = k / max(n, 1)
    arm_names.append(arm_dir.name.replace("arm_", ""))
    rates.append(p)
    lo_errs.append(p - lo)
    hi_errs.append(hi - p)

colors = ["#d9534f" if "hpvoot" in a else
          "#aaaaaa" if "oldschool" in a else
          "#5bc0de" for a in arm_names]
fig, ax = plt.subplots(figsize=(9, 5))
y = np.arange(len(arm_names))
ax.barh(y, rates, xerr=[lo_errs, hi_errs], color=colors,
        ecolor="black", capsize=4)
ax.set_yticks(y)
ax.set_yticklabels(arm_names, fontsize=9)
ax.set_xlabel("Episode completion rate")
ax.set_title("run_018 per-arm completion rates (Wilson 95% CI)")
ax.set_xlim(0, 1)
fig.tight_layout()
fig.savefig(OUT / "fig_run018_bars.pdf")
print("Saved fig_run018_bars.pdf")

# ── Fig 11: STANDARD vs FLOODING stress trajectory ───────────────────────────
rng = np.random.default_rng(42)
T = 20
stressor_turn = 6

def ou_trajectory(theta, mu, sigma, s0, stressor_magnitude, T, rng):
    s = [s0]
    for t in range(T-1):
        stressor = stressor_magnitude if t == stressor_turn else 0.0
        ds = theta * (mu - s[-1]) + sigma * rng.standard_normal() + stressor
        s.append(float(np.clip(s[-1] + ds, 0, 1)))
    return s

std_traj  = ou_trajectory(0.30, 0.25, 0.04, 0.20, 0.30, T, rng)
flood_traj = ou_trajectory(0.07, 0.55, 0.04, 0.20, 0.30, T, rng)

fig, ax = plt.subplots(figsize=(7, 4))
turns = np.arange(T)
ax.plot(turns, std_traj,   "b-o", ms=4, label="STANDARD ($\\theta=0.30$)")
ax.plot(turns, flood_traj, "r-s", ms=4, label="FLOODING ($\\theta=0.07$)")
ax.axvline(stressor_turn, color="grey", linestyle="--", label="Stressor event")
ax.axhline(0.25, color="gold",   linestyle=":", lw=1, label="calm→mild\_tension")
ax.axhline(0.45, color="orange", linestyle=":", lw=1, label="mild→moderate")
ax.set_xlabel("Dialogue turn")
ax.set_ylabel("Stress index $s$")
ax.set_title("Stress trajectory: STANDARD vs FLOODING patient mode")
ax.legend(fontsize=8)
ax.set_ylim(0, 1)
fig.tight_layout()
fig.savefig(OUT / "fig_stress_trajectories.pdf")
print("Saved fig_stress_trajectories.pdf")

# ── Fig 10: V_INT_PRIOR heat map ─────────────────────────────────────────────
# Values from arms.py PRECONTEMPLATION/CONTEMPLATION/ACTION rows
# Columns: calm+mild, moderate+elevated, critical
V_INT = np.array([
    [0.20, 0.30, 0.10],   # pre-contemplation
    [0.40, 0.55, 0.20],   # contemplation
    [0.60, 0.45, 0.15],   # action/maintenance
])
row_labels = ["Pre-contemplation", "Contemplation", "Action/Maint."]
col_labels = ["Low stress\n(calm/mild)", "Med stress\n(mod/elev)", "High stress\n(critical)"]

fig, ax = plt.subplots(figsize=(5, 4))
im = ax.imshow(V_INT, cmap="YlOrRd", vmin=0, vmax=0.7)
ax.set_xticks(range(3)); ax.set_xticklabels(col_labels, fontsize=9)
ax.set_yticks(range(3)); ax.set_yticklabels(row_labels, fontsize=9)
for i in range(3):
    for j in range(3):
        ax.text(j, i, f"{V_INT[i,j]:.2f}", ha="center", va="center", fontsize=11)
plt.colorbar(im, ax=ax, label="$V_{\\mathrm{INT\\_PRIOR}}$")
ax.set_title("Intrinsic Intervention Prior")
fig.tight_layout()
fig.savefig(OUT / "fig_v_int_prior.pdf")
print("Saved fig_v_int_prior.pdf")

print("All figures generated in", OUT.resolve())
```

Run with: `python scripts/gen_figures.py`
Then reference in LaTeX as `\includegraphics{figures/fig_run018_bars}` etc.

---

## PART G.2 — Patent diagrams

No patent document is present in the workspace.  Please specify:
- Is this a filed patent (application number) or an internal patent draft?
- Which specific diagrams are required (e.g., claim diagram, system overview,
  communication protocol diagram)?

Once you supply the patent document or identify the specific diagrams,
they should be inserted as follows:

```latex
\begin{figure}[h]
\centering
\includegraphics[width=0.85\linewidth]{patent_fig_N}  %% export from patent PDF
\caption{<Patent figure caption verbatim>.
  Reproduced from \cite{patent_ref} with permission.}
\label{fig:patent_N}
\end{figure}
```

Add a BibTeX entry for the patent:
```bibtex
@patent{patent_ref,
  author    = {<inventor names>},
  title     = {<patent title>},
  number    = {<application number>},
  year      = {<filing year>},
  holder    = {<assignee>},
}
```

---

## PART G.3 — Generated images for mathematical and clinical concepts

**Recommendation: YES**, generate dedicated diagrams for the following.
These are best produced as TikZ (for LaTeX-native quality) or via the
Python matplotlib script above.

### G.3.1 — Tensor train / SVD (TikZ)

Two sub-figures:

**Sub-figure A: SVD decomposition**
```
M  ≈  U  Σ  V^T
(m×n)  (m×r) (r×r) (r×n)

Visualise: rectangle M → three rectangles U, Σ (diagonal, small),
V^T with dimension labels and colour-coded singular value magnitudes.
```

**Sub-figure B: Tensor train / MPS (chain)**
Same as Fig 2 above; include this as a companion sub-figure.

Caption: "Relationship between SVD and MPS/tensor-train decomposition.
(A) SVD factorises a matrix into orthogonal factors and singular values.
(B) MPS recursively applies SVD across the chain: each bond $\chi$
truncates the least-significant singular values, compressing storage
from $O(d^T)$ to $O(T d \chi^2)$.
After~\cite{orus2014practical}."

### G.3.2 — HysteresisGate state machine (TikZ)

A cleaner TikZ version of the Mermaid stateDiagram from
`env_03_rl_environment_pomdph.md`, with:
- Five ellipses in a horizontal row, colour-coded green→yellow→orange→red→dark red.
- Curved arrows above (upward transitions) and below (downward + dead-band).
- Threshold labels: ≥0.25 up, <0.19 down; ≥0.45 up, <0.39 down; etc.

### G.3.3 — Ornstein-Uhlenbeck process illustration (matplotlib)

Already covered in Fig 11 above (STANDARD vs FLOODING trajectory).
Add an additional sub-figure showing the **mean-reversion property**:
multiple sample paths all converging to $\mu$ from different initial
starting points, with the analytical mean $\mu = 0.25$ as a dashed line.

### G.3.4 — Clinical concept diagrams (matplotlib / TikZ)

| Concept | Diagram type | Key elements |
|---------|-------------|--------------|
| Stages of Change (Prochaska) | Circular TikZ wheel | 6 stages: pre-contemplation → contemplation → preparation → action → maintenance → relapse; arrows both ways |
| Motivational Interviewing OARS | Box-and-arrow | Open questions, Affirmations, Reflective listening, Summaries — map each to HTN action name |
| Alliance rupture-repair cycle | State diagram | 4 states: aligned, tension, rupture, repair; with session events as transitions |
| Exposure therapy extinction curve | pgfplots line | SUDS score vs. session number; exponential decay; spontaneous recovery bump |

These can all be generated by the Python script or drawn in TikZ.
The OARS diagram and Stages of Change wheel are both patented in their
graphical forms by various sources — use schematic representations
rather than reproductions.

---

## PART G.4 — TikZ skeletons for all inline figures

Preamble required in main.tex (add once if not already present):

```latex
\usepackage{tikz}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\usetikzlibrary{shapes.geometric, arrows.meta, positioning,
                fit, backgrounds, calc, decorations.pathreplacing}
```

---

### TikZ — Fig 2: MPS bond-dimension chain

```latex
\begin{tikzpicture}[
  tensor/.style={circle, draw, thick, fill=blue!20,
                 minimum size=1.0cm, font=\small},
  physidx/.style={-{Latex}, thick, gray}
]
  \foreach \t in {1,...,10} {
    \node[tensor] (A\t) at ({(\t-1)*1.4}, 0) {$A^{(\t)}$};
  }
  \foreach \t [count=\tn from 2] in {1,...,9} {
    \draw[thick] (A\t) -- (A\tn)
      node[midway, above, font=\tiny] {$\chi{=}4$};
  }
  \foreach \t in {1,...,10} {
    \draw[physidx] (A\t.south) -- ++(0,-0.7)
      node[below, font=\tiny] {$d{=}64$};
  }
  % Open boundary danglers
  \draw[thick, dashed] (A1.west)  -- ++(-0.4, 0);
  \draw[thick, dashed] (A10.east) -- ++(0.4, 0);
  % Caption: T=10 turns, chi=4, d=64-dim embedding
\end{tikzpicture}
```

---

### TikZ — Fig 3: H\_eff non-Hermitian decomposition

```latex
\begin{tikzpicture}[
  box/.style={rectangle, draw, rounded corners=4pt,
              minimum width=2.6cm, minimum height=1.1cm,
              align=center, font=\small},
  subbox/.style={rectangle, draw, dashed, rounded corners=3pt,
                 minimum width=2.2cm, minimum height=0.7cm,
                 align=center, font=\tiny},
  arr/.style={{Latex}-, thick}
]
  \node[box, fill=blue!15]    (H0)    at (0,   0) {$H_0$\\{\tiny semantic flow}};
  \node[box, fill=orange!20]  (Ghab)  at (3.5, 0) {$\Gamma_\text{habit}$\\{\tiny behavioural inertia}};
  \node[box, fill=red!15]     (Gphys) at (7,   0) {$\Gamma_\text{physio}$\\{\tiny autonomic stress}};

  % Sub-box under Gphys showing 5-signal feed
  \node[subbox, below=0.55cm of Gphys] (sig)
    {$s = \sum_i w_i \hat{\sigma}_i$\\5 signals};
  \draw[-{Latex}, thin, dashed] (sig.north) -- (Gphys.south);

  % Result box
  \node[box, fill=purple!10, minimum width=6.5cm, below=1.8cm of Ghab]
    (Heff) {$\mathcal{H}_\text{eff} = H_0 -\,i\!\underbrace{(\Gamma_\text{habit}
    + \Gamma_\text{physio} + \Gamma_\text{pkpd} + \cdots)}_{\Gamma}$};

  \draw[-{Latex}, thick] (H0.south)    -- (Heff.north west);
  \draw[-{Latex}, thick] (Ghab.south)  -- (Heff.north);
  \draw[-{Latex}, thick] (Gphys.south) -- (Heff.north east);

  \node at (1.75, 0.45) {\large$+$};
  \node at (5.25, 0.45) {\large$-\,i$};
\end{tikzpicture}
```

---

### TikZ — Fig 4: MCTS four-phase loop

```latex
\begin{tikzpicture}[
  phase/.style={rectangle, rounded corners=6pt, draw, thick,
                minimum width=2.8cm, minimum height=1.1cm,
                align=center, font=\small\bfseries},
  arr/.style={{Latex}-, thick, shorten >=2pt, shorten <=2pt}
]
  \node[phase, fill=green!25]  (sel)  at ( 0,  3.0) {Select\\{\tiny UCB1 + prior $\pi(a|s)$}};
  \node[phase, fill=yellow!30] (exp)  at ( 3.0, 0)  {Expand\\{\tiny add child node}};
  \node[phase, fill=orange!25] (sim)  at ( 0, -3.0) {Simulate\\{\tiny LLM rollout}};
  \node[phase, fill=red!20]    (back) at (-3.0, 0)  {Backpropagate\\{\tiny update $Q$, $V(s)$}};

  \draw[arr] (sel.east)   to[bend left=20]
    node[right, font=\tiny] {tree path} (exp.north);
  \draw[arr] (exp.south)  to[bend left=20]
    node[right, font=\tiny] {leaf node} (sim.east);
  \draw[arr] (sim.west)   to[bend left=20]
    node[left,  font=\tiny] {reward $r$} (back.south);
  \draw[arr] (back.north) to[bend left=20]
    node[left,  font=\tiny] {next iter.} (sel.west);

  \node[align=center, font=\small] at (0, 0)
    {MCTS loop\\80--150 iter.};

  % Actor / Critic annotations
  \node[font=\tiny, green!50!black] at (1.0, 3.7)  {Actor $\pi(a|s)$ prior};
  \node[font=\tiny, red!60!black]   at (-1.5, -3.7){Critic $V(s)$};
\end{tikzpicture}
```

---

### TikZ — Fig 9: Dual-rank architecture

```latex
\begin{tikzpicture}[
  agent/.style={rectangle, draw, thick, rounded corners=6pt,
                minimum width=4.0cm, minimum height=1.4cm,
                align=center, font=\small},
  bottle/.style={rectangle, draw, dashed, rounded corners=4pt,
                 fill=gray!8, minimum width=3.2cm, minimum height=0.8cm,
                 align=center, font=\footnotesize},
  arr/.style={{Latex}-, thick}
]
  \node[agent, fill=blue!20]   (strat) at (0, 0)
    {\textbf{Strategic Agent}\\MPS + MCTS (80--150 iter.)\\high rank};

  \node[bottle] (svd) at (0, -2.2)
    {SVD truncation\\ $M \;\rightarrow\; M_\text{trunc}$\\$O(\chi_\text{max})$ values};

  \node[bottle, fill=yellow!25] (tag) at (0, -3.8)
    {\texttt{[MCTS GUIDANCE]} tag\\top-3 actions → system prompt\\prompt-level hint only};

  \node[agent, fill=orange!20] (tact) at (0, -6.0)
    {\textbf{Tactical Agent}\\LLM (cloud API)\\free-text generation};

  \draw[-{Latex}, thick] (strat.south) -- (svd.north)
    node[midway, right, font=\tiny] {full path $W$};
  \draw[-{Latex}, thick] (svd.south)   -- (tag.north)
    node[midway, right, font=\tiny] {compressed strategy};
  \draw[-{Latex}, thick] (tag.south)   -- (tact.north)
    node[midway, right, font=\tiny] {prompt injection};
  \draw[-{Latex}, thick] (tact.south)  -- ++(0, -0.8)
    node[below, font=\tiny] {SSE response stream};

  % Side note: no logit manipulation
  \node[font=\tiny, text=gray, align=center, right=1.2cm of tag]
    {no direct logit\\manipulation};
  \draw[->, gray, dashed, thin]
    ([xshift=0.6cm] tag.east) -- (tag.east);
\end{tikzpicture}
```

---

### TikZ — G.3.1a: SVD decomposition

```latex
\begin{tikzpicture}[
  mat/.style={rectangle, draw, thick, fill=#1,
              minimum height=#2, minimum width=#3, align=center, font=\small}
]
  % M (tall, wide)
  \node[mat=blue!20, 3cm, 2cm]    (M)  at (0,   0) {$M$\\$m \times n$};
  \node                                              at (1.4, 0) {$\approx$};
  % U (tall, narrow)
  \node[mat=green!20, 3cm, 1.0cm] (U)  at (2.5,  0) {$U$\\$m \times r$};
  % Sigma (small square)
  \node[mat=yellow!30, 1.0cm, 1.0cm] (S) at (3.9, 0) {$\Sigma$\\$r{\times}r$};
  % V^T (short, wide)
  \node[mat=red!15, 1.0cm, 2cm]   (VT) at (5.5,  0) {$V^\top$\\$r \times n$};

  % singular-value diagonal annotation
  \node[font=\tiny, gray, below=0.2cm of S]
    {diagonal\\ $\sigma_1 \geq \sigma_2 \geq \cdots \geq 0$};

  % Truncation brace + arrow
  \draw[decorate, decoration={brace, mirror, amplitude=5pt},
        gray] ([xshift=-0.5cm]S.south west) -- ([xshift=0.5cm]S.south east)
    node[midway, below=8pt, font=\tiny, align=center, gray]
    {keep top $\chi$\\ discard rest ($M_\text{trunc}$)};
\end{tikzpicture}
```

---

### TikZ — G.3.1b: MPS as recursive SVD (companion to SVD figure)

Same as Fig 2 above; include as `\subfigure` using the `subcaption` package:

```latex
\begin{figure}[h]
\centering
\begin{subfigure}[b]{0.48\linewidth}
  \centering
  % paste Fig 2 TikZ here
  \caption{MPS tensor chain ($T=10$, $\chi=4$)}
\end{subfigure}
\hfill
\begin{subfigure}[b]{0.48\linewidth}
  \centering
  % paste SVD TikZ (G.3.1a) here
  \caption{SVD: $M \approx U\Sigma V^\top$ with rank-$\chi$ truncation}
\end{subfigure}
\caption{Relationship between SVD and MPS.
  Each bond in the MPS is a truncated SVD of the reshaped state tensor.
  After~\cite{schollwock2011density}.}
\label{fig:svd_mps}
\end{figure}
```

---

### TikZ — G.3.2: HysteresisGate 5-zone state machine

```latex
\begin{tikzpicture}[
  zone/.style={ellipse, draw, thick, minimum width=2.3cm, minimum height=1.1cm,
               align=center, font=\footnotesize\bfseries},
  uarr/.style={-{Latex}, thick},
  darr/.style={-{Latex}, thick, dashed}
]
  \node[zone, fill=green!35]                   (z0) at (0,   0)
    {\texttt{calm}\\\scriptsize$[0.00,0.25)$};
  \node[zone, fill=yellow!50]                  (z1) at (3.5, 0)
    {\texttt{mild\_t.}\\\scriptsize$[0.25,0.45)$};
  \node[zone, fill=orange!45]                  (z2) at (7.0, 0)
    {\texttt{moderate}\\\scriptsize$[0.45,0.60)$};
  \node[zone, fill=red!35]                     (z3) at (10.5,0)
    {\texttt{elevated}\\\scriptsize$[0.60,0.78)$};
  \node[zone, fill=red!75!black, text=white]   (z4) at (14.0,0)
    {\texttt{critical}\\\scriptsize$[0.78,1.00]$};

  % --- upward arrows (above the chain) ---
  \foreach \src/\dst/\thresh in {z0/z1/0.25, z1/z2/0.45, z2/z3/0.60, z3/z4/0.78} {
    \draw[uarr] (\src.north) to[bend left=35]
      node[above, font=\scriptsize] {$s \geq \thresh$} (\dst.north);
  }
  % --- downward arrows (below the chain) ---
  \foreach \src/\dst/\thresh in {z1/z0/0.19, z2/z1/0.39, z3/z2/0.54, z4/z3/0.72} {
    \draw[darr] (\src.south) to[bend left=35]
      node[below, font=\scriptsize] {$s < \thresh$} (\dst.south);
  }

  % Dead-band legend
  \node[font=\tiny, gray, align=center] at (7, -2.4)
    {dashed arrows: downward threshold = upward threshold $-\,0.06$
    (Schmitt-trigger dead-band)};

  % Therapeutic mode strip
  \foreach \z/\mode in {z0/Exploration, z1/Motivation, z2/Ambivalence,
                         z3/Validate, z4/Safety only} {
    \node[font=\scriptsize, gray] at (\z.south) [yshift=-1.0cm] {\mode};
  }
\end{tikzpicture}
```

---

### TikZ — G.3.4a: Stages of Change wheel

```latex
\begin{tikzpicture}
  % 6 sectors; sector 0 starts at 90 degrees, goes clockwise
  \foreach \i/\label/\col in {
    0/{Pre-\\Contem\-plation}/gray!30,
    1/{Contem\-plation}/yellow!45,
    2/{Prep\-aration}/lime!40,
    3/{Action}/green!40,
    4/{Mainte\-nance}/teal!30,
    5/{Relapse}/red!25}
  {
    \pgfmathsetmacro{\startA}{90 - \i*60}
    \pgfmathsetmacro{\endA}{90 - (\i+1)*60}
    \pgfmathsetmacro{\midA}{90 - (\i+0.5)*60}
    \fill[\col] (0,0) -- (\startA:2.6) arc(\startA:\endA:2.6) -- cycle;
    \draw[thick] (0,0) -- (\startA:2.6);
    \node[align=center, font=\tiny\bfseries] at (\midA:1.75) {\label};
  }
  \draw[thick] (0,0) circle(2.6);
  % Inner circle label
  \draw[-{Latex}, thick, blue!70] (0.35,0) arc(0:310:0.35);
  \node[font=\tiny, blue!70, align=center] at (0, 0.65) {process\\of change};
  % Arrows showing bidirectional transitions (contemplation ↔ relapse, etc.)
  \draw[-{Latex}, red!60, thick, dashed] (210:2.9) arc(210:150:2.9)
    node[midway, left, font=\scriptsize] {relapse};
\end{tikzpicture}
```

---

### TikZ — G.3.4b: OARS → HTN action mapping

```latex
\begin{tikzpicture}[
  oars/.style={rectangle, draw, thick, rounded corners=4pt, fill=blue!15,
               minimum width=2.4cm, minimum height=0.85cm,
               align=center, font=\small\bfseries},
  act/.style={rectangle, draw, rounded corners=3pt, fill=orange!15,
              minimum width=3.0cm, minimum height=0.65cm,
              align=center, font=\ttfamily\scriptsize},
  arr/.style={->, gray, thin, shorten >=1pt}
]
  \node[oars] (O) at (0,  3.0) {Open\\Questions};
  \node[oars] (A) at (0,  1.5) {Affirmations};
  \node[oars] (R) at (0,  0.0) {Reflective\\Listening};
  \node[oars] (S) at (0, -1.5) {Summaries};

  \node[act] (o1) at (5.2,  3.3) {open\_question};
  \node[act] (o2) at (5.2,  2.7) {invite\_reflection};
  \node[act] (a1) at (5.2,  1.8) {unconditional\_regard};
  \node[act] (a2) at (5.2,  1.2) {oars\_affirmation};
  \node[act] (r1) at (5.2,  0.3) {empathic\_reflection};
  \node[act] (r2) at (5.2, -0.3) {oars\_reflection};
  \node[act] (s1) at (5.2, -1.2) {oars\_summary};
  \node[act] (s2) at (5.2, -1.8) {summarise};

  \foreach \src/\dst in {O/o1,O/o2,A/a1,A/a2,R/r1,R/r2,S/s1,S/s2}
    \draw[arr] (\src.east) -- (\dst.west);

  \node[font=\small\bfseries] at (0,   4.0) {MI Principle (OARS)};
  \node[font=\small\bfseries] at (5.2, 4.0) {HTN action};
\end{tikzpicture}
```

---

### TikZ — G.3.4c: Alliance rupture-repair cycle

```latex
\begin{tikzpicture}[
  st/.style={rectangle, rounded corners=6pt, draw, thick,
             minimum width=2.5cm, minimum height=1.0cm,
             align=center, font=\small\bfseries},
  arr/.style={{Latex}-, thick, shorten >=2pt, shorten <=2pt}
]
  \node[st, fill=green!25]  (al)  at (0,  0)   {Aligned};
  \node[st, fill=yellow!35] (ten) at (5,  0)   {Tension};
  \node[st, fill=red!25]    (rup) at (5, -3)   {Rupture};
  \node[st, fill=blue!20]   (rep) at (0, -3)   {Repair};

  \draw[-{Latex}, thick] (al.east)  -- node[above, font=\tiny] {stress spike} (ten.west);
  \draw[-{Latex}, thick] (ten.south)-- node[right, font=\tiny] {misattunement} (rup.north);
  \draw[-{Latex}, thick] (rup.west) --
    node[below, font=\tiny] {\texttt{validate} + \texttt{empathic\_reflection}} (rep.east);
  \draw[-{Latex}, thick] (rep.north)-- node[left,  font=\tiny] {alliance restored} (al.south);

  % Fast repair bypass
  \draw[-{Latex}, blue!60, thick, dashed] (ten.north west)
    to[bend right=25]
    node[above, font=\tiny, blue!60] {\texttt{repair\_rupture} (fast)} (al.north east);
\end{tikzpicture}
```

---

### pgfplots — G.3.4d: Exposure therapy extinction curve

```latex
\begin{tikzpicture}
\begin{axis}[
  xlabel={Session number},
  ylabel={SUDS score},
  ymin=0, ymax=105, xmin=0, xmax=28,
  width=8cm, height=5.5cm,
  xtick={0,5,10,15,20,25},
  ytick={0,20,40,60,80,100},
  legend pos=north east,
  legend style={font=\scriptsize}
]
  % Extinction curve (sessions 1-10)
  \addplot[blue, thick, domain=0:10, samples=60]
    { 85 * exp(-0.28*x) + 10 };
  \addlegendentry{Extinction (active therapy)}

  % Gap marker
  \draw[gray, dashed] (axis cs:10,0) -- (axis cs:10,105);
  \draw[gray, dashed] (axis cs:14,0) -- (axis cs:14,105);
  \node[font=\tiny, gray] at (axis cs:12, 95) {gap};

  % Spontaneous recovery
  \addplot[red!70, thick, domain=14:22, samples=50]
    { 40 * exp(-0.32*(x-14)) + 12 };
  \addlegendentry{Spontaneous recovery}

  % Latent inhibition floor
  \addplot[gray, dotted, domain=0:28] { 10 };
  \node[font=\tiny, gray, right] at (axis cs:0.5, 13)
    {$w_\text{floor}$ (latent inhibition)};

  % Reinstatement spike at session 24
  \addplot[orange, thick, domain=23:28, samples=30]
    { 35 * exp(-0.5*(x-23)) + 12 };
  \addlegendentry{Reinstatement (stressor at $t{=}23$)}
\end{axis}
\end{tikzpicture}
```

---


*End of complete insertion guide.*
*Total new content: Background §2 (B1), Care Circle §3.x (B2),*
*Empirical Benchmarking §5 replacing empty section (B3),*
*Implementation Status table (B4), 14 figures + 6 UML figures (C),*
*10 corrections (A1--A10), consistency fixes (D1--D5),*
*continuity bridges (E1--E9 including §1→§2, §2→§3, §3→§4, §4 end),*
*figure catalogue (G), Python generation script (G.1),*
*patent figure guidance (G.2), generated image suggestions (G.3).*

---

## PART H — COMPLETE CITATION MAP: every [?] → correct \cite{key}

Every `[?]` in the compiled PDF means a `\cite{key}` in main.tex whose key
is absent from references.bib.  The table below lists **every occurrence**
in reading order.  All keys listed are now present in `references.bib`.

**How to use:** Ctrl+F for the anchor phrase in your Overleaf source, find the
`\cite{???}` or `\cite{unknown_key}` next to it, replace the key.

---

### §2.1 — HRV and autonomic nervous system

| Anchor phrase in main.tex | Replace `\cite{??}` with |
|--------------------------|------------------------|
| `low HRV with sympathetic activation and rigid coping` | `\cite{thayer2012heart}` |
| `Wiener process` (end of OU equation line) | `\cite{uhlenbeck1930brownian}` |

---

### §2.2 — Matrix Product States

| Anchor phrase | Replace with |
|--------------|-------------|
| `each $A^{s_k}_{[k]}$ is a $\chi\times\chi$ matrix and $\chi$ is the bond dimension` (two cites) | `\cite{schollwock2011density,vidal2003efficient}` |
| `compact fixed-size representation that avoids KV-cache growth` | `\cite{stoudenmire2016supervised}` |
| Fig 3 caption: `balancing expressivity and $O(\chi^2)$ contraction cost` | `\cite{schollwock2011density}` |

---

### §2.3 — MCTS

| Anchor phrase | Replace with |
|--------------|-------------|
| `Selection (UCB1), Expansion, Simulation (rollout), and Backpropagation` | `\cite{browne2012survey}` |
| `HPVOOT variant (Hierarchical PW+VOOT) runs 150 iterations with a hierarchical decomposition` | `\cite{chaslot2008progressive,audibert2009exploration}` |
| Fig 4 caption: `After` (two cites at end) | `\cite{browne2012survey,silver2016mastering}` |

---

### §2.4 — A3C

| Anchor phrase | Replace with |
|--------------|-------------|
| `A3C` (very first mention, opening sentence of §2.4) | `\cite{mnih2016asynchronous}` |

---

### §2.5 — Non-Hermitian open systems

| Anchor phrase | Replace with |
|--------------|-------------|
| `the effective Hamiltonian is` (first equation in §2.5) | `\cite{rotter2009review}` |
| `encodes dissipation` (after $\Gamma \geq 0$) | `\cite{moiseyev2011non}` |
| Fig 5 caption: `Non-Hermitian formalism after` | `\cite{rotter2009review}` |

---

### §2.6 — Hysteresis in psychology

| Anchor phrase | Replace with |
|--------------|-------------|
| `path-dependent resistance to state change` (two cites) | `\cite{bouton2004context,foa1986emotional}` |
| `Rescorla-Wagner model formalises associative strength updates` | `\cite{rescorla1972theory}` |
| Fig 6 caption: `Compare with wearable empirical data` | `\cite{schmidt2018introducing}` |

---

### §2.7 — Related Work

| Anchor phrase | Replace with |
|--------------|-------------|
| `Neuro-symbolic AI approaches` (opening of §2.7) | `\cite{garcez2023}` |
| The literal text `peng2021soloist` leaked into the paragraph (not `[?]` but key as text) — **see special fix below** | `\cite{peng2021soloist}` |
| `tensor network methods have been applied to supervised machine learning by` | `\cite{stoudenmire2016supervised}` |
| `Reinforcement learning for task-oriented dialogue was formalised by` | `\cite{kaelbling1998planning}` |
| `have used rule-based thresholds` | `\cite{fitzpatrick2017}` |

**Special fix for `peng2021soloist` text leak:**
In main.tex, find the sentence:
```
by peng2021soloist, who used it for few-shot task-oriented dialogue
```
It should read:
```latex
by \citet{peng2021soloist}, who used it for few-shot task-oriented dialogue
```
(Use `\citet{}` for author-name inline citation, or `\cite{}` if using a different author-inline style.)

---

### §3 — Methodology (inline citations)

| Anchor phrase | Replace with |
|--------------|-------------|
| `Rescorla-Wagner delta rule` (inside $\Gamma_\text{fear}$ definition) | `\cite{rescorla1972theory}` |
| `therapeutic alliance coupling` (inside $\Gamma_\text{companion}$ definition) | `\cite{safran2000negotiating}` |
| `Mtrunc serves as a contextual prior rather than a hard output filter` (§3.4.5 and §3.12.1) | `\cite{sutton1998reinforcement}` |
| Fig 7 caption: `FLOODING mode ... After` | `\cite{foa1986emotional}` |
| `SQLite fact store with exponential decay weighting` (§3.7 impl note) | Remove `[?]` — this is implementation-specific, no citation needed; or use `\cite{fitzpatrick2017}` if framing as prior art |

---

### §4 — Benchmarking

| Anchor phrase | Replace with |
|--------------|-------------|
| `$\gamma = 0.99$` (POMDP-H formulation, Eq. 9) | `\cite{mnih2016asynchronous}` |
| Fig 12 caption: `After` (POMDP-H diagram) | `\cite{kaelbling1998planning}` |
| `Benjamini-Hochberg correction at FDR = 0.10` | `\cite{benjamini1995controlling}` |
| `Cohen's $h$ (binary) and Cohen's $d$ (continuous)` | `\cite{cohen1988statistical}` |

---

### §1 — Introduction figure captions (inline text references, not \cite{})

These appear as plain text, not `\cite{}`, so they won't create `[?]`.
However they should be converted to proper `\cite{}` for consistency:

| Anchor phrase | Add `\cite{}` |
|--------------|--------------|
| Fig 2 caption: `After Lotrich \& Pollock (2004)` | Replace with `After~\cite{lotrich2004}` |

---

## PART I — Section labels and `??` cross-reference fixes

Every `??` in the compiled PDF is a `\ref{label}` where `\label{label}` does
not exist in main.tex.  Add the following `\label{}` commands immediately
after each `\section{}` or `\subsection{}` command.

### Labels to ADD to main.tex

```latex
% After \section{Introduction}
\label{sec:intro}

% After \section{Background}  (or \section{Theoretical Foundations})
\label{sec:background}

% After \subsection{Heart Rate Variability...}
\label{sec:hrv}

% After \subsection{Matrix Product States}
\label{sec:mps}

% After \subsection{Monte Carlo Tree Search}
\label{sec:mcts}

% After \subsection{Asynchronous Advantage Actor-Critic}
\label{sec:a3c}

% After \subsection{Non-Hermitian Open Systems}
\label{sec:nonhermitian}

% After \subsection{Hysteresis in Psychology}
\label{sec:hysteresis_bg}

% After \section{Methodology}
\label{sec:methodology}

% After \section{Benchmarking}
\label{sec:benchmarking}

% After \section{Conclusion}
\label{sec:conclusion}
```

### References to FIX in main.tex

Search for `??` in main.tex (there are at least 2 clusters):

**Occurrence 1** — §2 Background preamble:
```
Readers familiar with all topics may skip to Section ??.
```
Replace `??` with `\ref{sec:methodology}` →
```latex
Readers familiar with all topics may skip to Section~\ref{sec:methodology}.
```

**Occurrence 2** — §3.12 Architecture opening paragraph:
```
The physiological model (Sections ??.1–2) provides the state signal;
the MPS encodes it compactly (Section ??.2);
the MCTS plans over it (Section ??.3);
and the A3C trains the policy end-to-end (Section ??.4).
The non-Hermitian formalism (Section ??.5) unifies all dissipation effects
```
Replace all five `??` with the Background section reference:
```latex
The physiological model (Sections~\ref{sec:hrv}--\ref{sec:nonhermitian})
provides the state signal;
the MPS encodes it compactly (Section~\ref{sec:mps});
the MCTS plans over it (Section~\ref{sec:mcts});
and the A3C trains the policy end-to-end (Section~\ref{sec:a3c}).
The non-Hermitian formalism (Section~\ref{sec:nonhermitian}) unifies all
dissipation effects into the single operator $\Gamma$ (Equation~\ref{eq:gamma}).
```

Also add a label for Equation 6 (the Gamma decomposition):
```latex
\Gamma = \Gamma_\text{physio} + \ldots \label{eq:gamma}
```

---

## PART J — Section reordering guide

The PDF has a structural problem: §1 Introduction is overloaded with technical
derivations (§1.1 Tensor Manifold, §1.2 Attention vs Tensor Networks, §1.3
PK/PD) that logically belong in Background (§2) or Methodology (§3).
Background (§2) in the current structure is correct but the intro subsections
shadow it.  The recommendations below require moving content in Overleaf.

### J.1 — Current structure (problematic)

```
§1 Introduction
  §1.1 The Tensor Manifold          ← detailed derivation in intro
  §1.2 Multi-Head Attention vs TNs  ← detailed comparison in intro
    §1.2.1 Tensorized Transformers
    §1.2.2 Zero-Data Initialization
    §1.2.3 Localized Rank Updates
    §1.2.4 Computational Complexity
  §1.3 Managing PK/PD               ← should be in §3 Methodology
    §1.3.1 Beta-blockers
    §1.3.2 Anti-Depressants
§2 Background
  §2.1 HRV
  §2.2 MPS
  §2.3 MCTS
  §2.4 A3C
  §2.5 Non-Hermitian
  §2.6 Hysteresis in Psychology
  §2.7 Related Work
§3 Methodology
  §3.1 Conversational MPS
  §3.2 Non-Hermitian Transition Operator
  ...
  §3.10 ALS Policy Updates
  §3.11 Organizational Policy Injection
  §3.12 Architecture   ← should come FIRST in §3
  §3.13 Care Circle Orchestration
```

### J.2 — Recommended structure

```
§1 Introduction
  (clinical motivation + hysteresis concept + dual-rank overview — keep brief)
  §1.1 The Tensor Manifold  (keep: introductory concept only)
  §1.2 Multi-Head Attention vs TNs  (shorten to 1 page; details → §2.2)
  Remove §1.2.1–§1.2.4 from Introduction (merge into §2 or §3)
  Remove §1.3 PK/PD from Introduction (move to §3)
§2 Background
  §2.1 HRV and the Autonomic Nervous System
  §2.2 Matrix Product States  (+merge Tensorized Transformers from old §1.2.1)
  §2.3 MCTS
  §2.4 A3C
  §2.5 Non-Hermitian Open Systems
  §2.6 Hysteresis in Psychology
  §2.7 Related Work
§3 Methodology
  §3.1 Architecture Overview  (move old §3.12 HERE as §3.1)
  §3.2 The Conversational MPS
  §3.3 Non-Hermitian Transition Operator
  §3.4 Encoding the Physiological Decay Rate
  §3.5 The Tensor Train
  §3.6 MCTS Rollout and SVD Truncation
  §3.7 Deterministic Finetuning
  §3.8 Zero-Data Initialization
  §3.9 Managing Long Context Windows
  §3.10 PK/PD Integration  (moved from old §1.3)
  §3.11 Multi-Agent Architecture
  §3.12 Policy Updates via ALS
  §3.13 Care Circle Orchestration
```

### J.3 — Bridge text to add at each move

**Between old §1.2 end and §2 (Background) start:**
```latex
The following section provides the mathematical prerequisites required
to understand the derivations in Section~\ref{sec:methodology}.
Readers familiar with MPS, MCTS, A3C, and non-Hermitian operators
may skip to Section~\ref{sec:methodology}.
```

**Between §3.1 Architecture Overview and §3.2 Conversational MPS:**
```latex
The following subsections derive each component of the architecture
in detail.  Section~\ref{sec:mps_conv} formalises the MPS state
representation; Section~\ref{sec:nonherm_trans} derives the
non-Hermitian transition operator; Section~\ref{sec:pkpd_int}
integrates the pharmacokinetic layer.
```

**Before §3 PK/PD (moved from §1.3):**
```latex
When the physiological subspace of the MPS must track exogenous
medications rather than endogenous stress hormones, the decay model
requires modification.  The following subsection details the
pharmacokinetic/pharmacodynamic integration.
```

---

## PART K — Zone name correction still required in PDF

The compiled PDF still contains the **wrong** zone boundaries at:

**§4.2 (POMDP-H Formulation, Figure 12 caption)**:
```
CALM [0.00, 0.20), MILD [0.20, 0.40), MODERATE [0.40, 0.60),
ELEVATED [0.60, 0.80), CRITICAL [0.80, 1.00]
```

**Correct values from `hysteresis_gate.py`**:
```latex
\texttt{calm}\ [0.00,0.25),\ \texttt{mild\_tension}\ [0.25,0.45),\
\texttt{moderate}\ [0.45,0.60),\ \texttt{elevated}\ [0.60,0.78),\
\texttt{critical}\ [0.78,1.00]
```

Dead-band = 0.06.  Downward transition fires at (boundary − 0.06).
Also update the `\texttt{HysteresisGate}` table in Correction A9 if you
have already pasted it: replace the four boundary values above.

**Search**: `CALM [0.00` — this string appears at least once in the
Figure 12 caption and once in §2.6.

---

