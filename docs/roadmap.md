# Research Bot implementation plan

The local beta now implements the stages below. Build, backend tests, browser workflow checks, live scholarly retrieval, and packaged Electron startup/restart have been verified. Live ChatGPT account authorization, AI-output fidelity evaluation, and researcher-led acceptance sessions remain open. See [implementation and validation notes](implementation.md).

## Goal and delivery order

Deliver a local personal research app: rough thoughts → research question → method and plan → sources → reading notes → grammar review → export. The researcher chooses the direction, evaluates evidence, and writes conclusions.

Proposed stack: Electron, React, TypeScript, and SQLite. Keep authentication and AI requests in the main process. Four specialist roles share one provider adapter, project storage, and review interface.

Verify authentication before investing in the full interface. Then build the workspace, methods coach, evidence finder, grammar editor, brainstorming partner, and integrated beta, in that order. The phase headings below describe their deliverables; this paragraph defines their execution order.

## Estimated effort

| Delivery stage                           | Working days | Checkpoint                                                      |
| ---------------------------------------- | ------------ | --------------------------------------------------------------- |
| Official authentication spike            | 1–3          | Real sign-in and streamed request with the researcher's account |
| Persistent local workspace               | 2–3          | Two isolated projects survive restart and export correctly      |
| Methods coach and editable plan          | 2–3          | Rough thoughts become a scoped question and feasible steps      |
| Evidence discovery and literature matrix | 4–6          | Retrieved sources and supported claims are traceable            |
| Grammar review                           | 2–3          | Minimal corrections can be accepted, rejected, and undone       |
| Brainstorming                            | 1–2          | Ideas are labeled and remain separate from accepted writing     |
| Integration and installer                | 3–4          | A complete research session works after a clean installation    |

Estimate: 15–24 working days for one developer after access requirements are resolved. This is a planning range, not a delivery commitment. Authentication eligibility, provider access, and installer requirements may change it.

## Critical first checkpoint

Implement the smallest local authentication shell first, rechecking the official documentation linked in [authentication.md](authentication.md). Verify model access, secure token storage, a streamed response, refresh, sign-out, and allowance errors. If eligibility is blocked, continue only provider-independent workspace work and document the blocker. A mock provider must be labeled as simulated. Do not switch to a separately billed API route without the researcher's explicit choice.

## 1. Local workspace

Create the Electron/React/TypeScript shell and SQLite migrations. Add project creation, notes, the four work areas, and export.

Use a project list, central notes/research area, and an assistant panel with four selectable roles. Store original/versioned notes, suggestions, sources, evidence entries, plan steps, and run records. Keep suggestions separate from accepted content. Add shared progress, cancellation, retry, and error handling once for every role. Bind each run to its originating project.

Acceptance: create two projects, restart the app, recover both without mixing content, edit a note, and export it. Clearly label any development mock output.

## 2. ChatGPT authentication spike

Implement the documented sign-in route in the main process, secure credential storage, model discovery, and one streamed request. Verify the researcher's account supports eligible plan usage before expanding the integration.

Acceptance: sign in, decline consent, cancel sign-in, refresh an expired token, recover from revocation, sign out, and confirm renderer/export/logs contain no tokens. Show allowance errors without switching providers.

## 3. Grammar editor

Connect the grammar instructions to the provider and implement original/proposed text comparison with accept/reject controls.

Send only the selected passage. Support individual edit acceptance and undo. Flag changes to numbers, citations, technical terms, or large passages for review; these checks do not prove semantic fidelity. Assess 20 representative passages before release. Any added idea, stylistic vocabulary substitution, or changed claim in that evaluation requires a fix and recheck of affected cases.

Acceptance: evaluate ungrammatical prose, already-correct text, domain terms, quotations, ambiguous text, and text containing instructions to rewrite. Corrections preserve meaning and vocabulary except necessary grammatical/spelling changes. Rejecting changes preserves the original. Manually assess fidelity rather than treating a diff as proof.

## 4. Evidence finder

Implement source adapters, provenance records, source saving, deduplication, and the literature matrix.

Begin with one scholarly provider after verifying its current documentation and access terms. Add permitted report/forum search where available; otherwise show the limitation and offer search queries. Deduplicate by normalized DOI and canonical URL. Record queries, retrieval dates, inspected material, and inclusion/exclusion decisions. Distinguish search results from sources the researcher has retained. Extract findings only from inspected material and attach source locators where available.

Acceptance: retrieve real sources for a sustainability question; manually match titles and DOI/URLs; distinguish abstract-only results from full-text inspection; handle a failed search, inaccessible paper, and missing metadata. Never fill a literature-matrix field with invented findings.

## 5. Brainstorming and methods coach

Implement role routing, candidate ideas, method explanations, and an editable ordered plan.

Build methods coaching first: question, assumptions, method options, data needs, feasibility, and ordered steps with purpose, output, dependencies, and completion checks. Build brainstorming later using the same infrastructure. Each idea needs assumptions, evidence required, and a small next step. Claims of novelty or a research gap require a supporting search. Transferring a suggestion into a note or plan requires an explicit researcher action.

Acceptance: convert rough food-waste research notes into a scoped plan; explain method tradeoffs, outputs, dependencies, feasibility, and limitations; label untested ideas; keep suggestions separate from the researcher's writing.

## 6. Integrated research session

Add coordinated runs, progress, cancellation, request budgets, and error recovery.

Complete two realistic sessions: university food waste and a second unrelated subject. Exercise cancellation during streaming/search, restart recovery, unavailable connectivity, token revocation, export, and deletion. Package for the researcher's operating system and smoke-test a clean installation. Release only after the researcher completes a session without developer assistance and exports match accepted content.

Acceptance: complete the example workflow from question to sources, reading notes, accepted plan, grammar corrections, and export. Check cross-project isolation and deletion. Test instructions embedded in retrieved documents do not redirect tools or expose credentials.

## Later decisions

The second research approach, public hosting, collaboration, citation styles, institution-specific workflows, and public licensing remain future decisions. The initial application should be usable locally before adding them.

## Efficiency rules

- Run one selected role per request by default; do not invoke every agent automatically.
- Reuse one provider adapter and shared review, streaming, persistence, cancellation, and error handling.
- Coordinate combined tasks locally, initially allowing at most two concurrent AI requests. Send each role only the context it needs.
- Cap automatic retries at one for retryable failures. Never retry declined consent or unsupported-account errors automatically.
- Show per-run usage when available and configurable request limits; state when usage information is unavailable.
- Cache source metadata with a documented freshness window and manual refresh; deduplicate identifiers to avoid repeated retrieval.
- Keep project history local and send selected context explicitly. Do not assume server-side conversation storage is available.
- Finish and demonstrate one useful workflow before starting several new features.

## Working rhythm and dependencies

For each stage: define the acceptance checklist, implement the smallest useful workflow, demonstrate it with real inputs, fix failures, and commit. Maintain a short decision log with the decision, reason, and evidence. Update estimates when dependencies become known.

Resolve the target operating system before OS-specific credential storage and packaging. Interactive sign-in with the researcher's eligible account is needed for live authentication validation. Source-provider access must be verified before committing to a retrieval implementation. The second research approach must be described before expanding scope.

The project repository is [Srimi1/research------bot](https://github.com/Srimi1/research------bot). Source, tests, and documentation are tracked there; desktop binaries belong in releases rather than Git history.
