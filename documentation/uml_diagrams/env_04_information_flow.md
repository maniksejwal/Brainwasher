# Environment Diagram 4 — Information Flow (Logical View)

> **View:** 4+1 Logical View  
> **Purpose:** Traces a single message from the user's browser through
> every processing stage to the SSE response. Shows parallel vs sequential
> steps, the physio/ML side-channel, and the cross-user intervention path.

## Full Request Lifecycle

```mermaid
sequenceDiagram
    actor User
    participant server as server.js
    participant router as contextAwareCompanionRouter.js
    participant CC as CompanionCoordinator.js
    participant IQ as InterventionQueue\n(db/queries_interventions.js)
    participant factRAG as retrieveRelevantFacts\n(db/queries_facts.js)
    participant bridge as tensornetsBridge.js
    participant fastapi as FastAPI :8765
    participant actionSel as action_selector prompt
    participant unifiedAgent as unifiedAgent.js
    participant scout as Scout LLM
    participant maverick as Maverick LLM
    participant privacy as privacyGuard.js
    participant db as care_circle_dev.db
    participant orch as orchestrator.js

    User->>server: POST /api/message { text, circleId, role }
    server->>router: route(req, res)
    router->>CC: coordinateCompanions(userId, role, message, circleId, context)

    par Parallel handler fan-out (Step 1)
        CC->>CC: inputUnderstanding — intent, entities, facts
    and
        CC->>CC: historyAnalyzer — priorTopics, mood, repetition
    and
        CC->>CC: empathyHandler — empathyLevel, tone
    and
        CC->>CC: stateTracker — stateSnapshot update
    end

    Note over CC: enhancedContext assembled from handler results

    par Async enrichment (Step 2.5 — parallel)
        CC->>bridge: getLongitudinalHint(userId)
        bridge->>fastapi: GET /longitudinal_hint
        fastapi-->>bridge: hint string (phase, alliance, secrets)
        bridge-->>CC: longitudinalHint
    and
        CC->>factRAG: retrieveRelevantFacts(circleId, topic, mpsHint)
        factRAG->>db: SELECT facts_v2 WHERE circleId (filtered + scored)
        db-->>factRAG: rows
        factRAG-->>CC: knownContextBlock (plain-text prompt block)
    and
        CC->>bridge: queryTensorRAGContext(text, physio_state)
        bridge->>fastapi: POST /tensor_rag
        fastapi-->>bridge: clinical KB + episode memory context
        bridge-->>CC: tensorRAGContext
    and
        CC->>IQ: peekInterventionQueue(userId, stressIndex)
        IQ->>db: SELECT interventions WHERE target_user_id = userId
        db-->>IQ: pendingIntervention | null
        IQ-->>CC: pendingInterventionBlock
    end

    CC->>privacy: processPrivacyDecision(userId, role, message, circleId, enhancedContext)
    privacy->>db: getCircleMembers + getImpliedConsent
    db-->>privacy: members[], consentRecords
    privacy->>scout: LLM call — classify privacy level + sharing suggestion
    scout-->>privacy: { privacyLevel, sharingSuggestion, requiresConsent }
    privacy-->>CC: { level, sharingSuggestion, consentCheck }

    CC->>actionSel: build action_selector prompt\n(stress, phase, available actions,\nknownContext, longitudinalHint,\ntensorRAG, pendingIntervention)
    actionSel->>unifiedAgent: processUserMessage(actionPrompt)
    unifiedAgent->>scout: LLM call — select action + FRAMES component
    scout-->>unifiedAgent: { action, frames_component, lookahead_hint }
    unifiedAgent-->>CC: selectedAction, framesComponent

    alt selectedAction == surface_intervention
        CC->>IQ: markSurfaced(item_id, currentTurn)
    end

    CC->>unifiedAgent: processUserMessage(patientOptimizerPrompt,\naction + FRAMES guidance)
    unifiedAgent->>scout: LLM call — generate reply
    scout-->>unifiedAgent: reply text
    unifiedAgent-->>CC: draftReply

    CC->>bridge: scoreCandidates(physioState, [draftReply, alternatives])
    bridge->>fastapi: POST /score_candidates
    fastapi-->>bridge: { best: { candidate_text, projected_stress } }
    bridge-->>CC: best reply (MCTS-scored)

    alt privacyLevel == SENSITIVE
        CC-->>server: filtered/redacted response
    else privacyLevel == PRIVATE or PUBLIC
        CC->>db: INSERT messages (circleId, role, text, intent, selectedAction)
        CC-->>server: finalReply
    end

    server-->>User: SSE { type: message, reply, intent, mcts_score }

    opt Cross-user path (async, next session)
        CC->>IQ: addPendingIntervention(targetUserId, concern, summary)
        IQ->>db: INSERT interventions (target_user_id, concern_type, urgency)
        Note over IQ: Surfaces to target user on their next peekInterventionQueue
    end

    opt Escalation path (parallel, if action == escalate or stress > 0.85)
        CC->>orch: emit("escalate", { circleId, level, stress_index })
        orch->>db: addEscalation(circleId, level, description)
        orch-->>server: broadcast SSE escalation event
        Note over server: ⚠ Currently broadcasts to payload.userId only
        server-->>User: SSE { type: escalation, level }
    end

    opt Offline scoring (async, after response sent)
        CC->>maverick: score response (goal_progress, trust_delta, safety)
        maverick-->>CC: scores
        CC->>db: UPDATE episode_log (goal_progress, trust_delta)
    end
```

## Key data objects passed through the pipeline

| Stage | Object | Contents |
|-------|--------|----------|
| Handler fan-out output | `enhancedContext` | intent, entities, facts, priorTopics, mood, repetitionFlag, empathyLevel, stateSnapshot |
| Fact RAG output | `knownContextBlock` | Plain-text block of top-6 scored facts, session-local facts separated |
| Longitudinal hint | `longitudinalHint` | Short string: therapeutic phase, alliance score, session secrets |
| Action selector output | `selectedAction` | One of 22 actions; `framesComponent` (FRAMES letter) |
| Privacy guard output | `sharingSuggestion` | `{ target, content_to_share, requiresConsent }` or null |
| MCTS candidate scoring | `mcts_score` | Projected stress index for the chosen response candidate |
| Intervention queue item | `pendingIntervention` | `{ concern_type, urgency_score, concern_summary, suggested_action }` |

## Parallel vs sequential summary

```
PARALLEL (fan-out):
  inputUnderstanding | historyAnalyzer | empathyHandler | stateTracker

PARALLEL (enrichment):
  getLongitudinalHint | retrieveRelevantFacts | queryTensorRAGContext | peekInterventionQueue

SEQUENTIAL (must be in order):
  → privacyGuard (needs enhancedContext from fan-out)
  → action_selector (needs all enrichment + privacy result)
  → patientOptimizer / role optimizer (needs selectedAction + FRAMES)
  → scoreCandidates (needs draft reply)
  → DB write + SSE response
```
