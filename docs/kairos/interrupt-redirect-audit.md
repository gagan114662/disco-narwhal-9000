# Interrupt And Redirect Audit

Date: 2026-04-22

Scope: issue #48, non-trunk only. This note was prepared from the current workspace checkout before any implementation edits.

## 1. What exists today?

### Current interrupt paths

`Ctrl+C` / `Escape`

- `src 2/hooks/useCancelRequest.ts:87-220` owns the active cancel keybindings.
- When a turn is active, `handleCancel()` clears pending tool confirmations and calls the REPL `onCancel()` callback.
- `Escape` only activates in chat contexts that are not transcript/history/help/overlay states. `Ctrl+C` is a global interrupt when a task or queued command exists.

Queued message while a tool is running

- `src 2/utils/messageQueueManager.ts:123-149` enqueues new user commands into the unified queue.
- `src 2/hooks/useQueueProcessor.ts:48-67` drains the queue only when no query is active.
- While a query is active, queued user input is surfaced as `queued_command` attachments via `src 2/utils/attachments.ts:1062-1098`.
- Live prompt-area preview is rendered by `src 2/components/PromptInput/PromptInputQueuedCommands.tsx:71-116`.

`/stop` command

- I did not find a slash command named `/stop` in this checkout. The only stop-related behavior I found is keybinding-driven cancellation and stop hooks.

Cancellation signal flow

Main-thread local run:

1. `src 2/hooks/useCancelRequest.ts:95-115` decides whether to cancel the active turn or pop queued input.
2. `src 2/screens/REPL.tsx:2140-2163` aborts the local `AbortController` or sends a remote interrupt, then clears the controller and forces turn-complete bookkeeping.
3. `src 2/query.ts:1055-1061` and `src 2/query.ts:1510-1516` convert aborts into synthetic interruption messages unless the abort reason is the special submit-interrupt redirect path.

Stop-hook path:

- `src 2/query/stopHooks.ts:284-293` emits a synthetic interruption message if cancellation lands during stop-hook execution.

Remote run:

- `src 2/screens/REPL.tsx:2148-2150` calls `activeRemote.cancelRequest()`.
- `src 2/remote/RemoteSessionManager.ts:292-296` sends a remote `interrupt` control request.

### Where state tears down vs. carries over

Torn down immediately

- Pending permission confirmations are cleared in `src 2/hooks/useCancelRequest.ts:97-100`.
- The active `AbortController` is cleared in `src 2/screens/REPL.tsx:2155-2159`.
- On teammate-view Ctrl+C, running background agents are killed and converted into a single task notification in `src 2/hooks/useCancelRequest.ts:169-195`.

Carried over

- Queued user prompts remain in the module-level queue until the turn finishes; they are only auto-drained when `useQueueProcessor` observes idle state (`src 2/hooks/useQueueProcessor.ts:48-67`).
- Human-entered queued prompts are preserved as transcript-visible `queued_command` attachments (`src 2/utils/attachments.ts:1062-1098`).
- Idle cancel against queued prompts can pull them back into the input buffer via `popAllEditable()` in `src 2/screens/REPL.tsx:2165-2184`.

## 2. What breaks today?

I documented four concrete failure modes in the current code path.

### Failure mode A: cancel acknowledgement is generic and loses what was interrupted

Reproduction:

1. Start a long streaming turn.
2. Press `Ctrl+C`.
3. Compare the rendered acknowledgement for a response-stream abort vs. a tool-call abort.

Observed in code:

- All visible cancel messages collapse to the same `Interrupted · What should Claude do instead?` component in `src 2/components/InterruptedByUser.tsx:1-14`.
- Both the non-tool and tool abort sentinels are rendered through that same generic component in `src 2/components/messages/UserTextMessage.tsx:83-89` and `src 2/components/messages/UserToolResultMessage/UserToolErrorMessage.tsx:31-39`.

Impact:

- The transcript does not tell the reader whether the user interrupted model output, a tool run, or another cancelable phase.

### Failure mode B: queued message capture is visible, but not explicitly acknowledged as queued

Reproduction:

1. Start a long tool run.
2. Type a new prompt and press `Enter`.
3. Look at the prompt-area preview.

Observed in code:

- `PromptInputQueuedCommands` renders the raw queued prompt as a normal user message preview in `src 2/components/PromptInput/PromptInputQueuedCommands.tsx:84-113`.
- There is no explicit queued label, truncation badge, or redirect-specific chrome.

Impact:

- The preview can be mistaken for normal transcript content instead of “captured and waiting.”

### Failure mode C: when the queued prompt is later applied, the transcript gives no redirect marker

Reproduction:

1. Queue a new prompt during a running turn.
2. Let the running turn finish or cancel.
3. Inspect the transcript where the queued prompt is replayed.

Observed in code:

- `queued_command` attachments are converted into plain prompt text and images in `src 2/components/messages/AttachmentMessage.tsx:241-252`.
- The transcript row looks like a normal user prompt; there is no “redirected” indicator even though the prompt arrived mid-turn.

Impact:

- Later transcript review loses the mid-task redirect context and ordering is harder to reconstruct.

### Failure mode D: exact one-line cancel guarantees and cleanup-before-ack cannot be enforced from non-trunk code

Reproduction:

1. Inspect all abort branches for local turns, remote turns, and stop hooks.
2. Compare where the abort is initiated vs. where the synthetic interruption message is yielded.

Observed in code:

- The user-facing interruption message is emitted inside trunk-owned query execution (`src 2/query.ts:1055-1061`, `src 2/query.ts:1510-1516`, `src 2/query/stopHooks.ts:284-293`).
- The initiating keybinding and REPL abort plumbing are also trunk-owned (`src 2/hooks/useCancelRequest.ts:87-220`, `src 2/screens/REPL.tsx:2140-2163`).

Impact:

- A “never silent cancel” guarantee, an idle “nothing to cancel” message, or a cleanup-registry callback that must run before the ack all require trunk integration.

## 3. Which fixes are non-trunk?

### Fixable without trunk edits

- Add explicit queued-message preview chrome in non-trunk UI so a captured prompt is visibly marked as queued.
- Add a redirect marker when `queued_command` attachments are rendered back into the transcript.
- Improve the visible cancel acknowledgement copy in non-trunk renderers so tool interrupts and general turn interrupts are distinguishable.

### Requires trunk change

- Guarantee that every cancel path emits exactly one acknowledgement line.
- Add a user-facing idle `Ctrl+C` / `Escape` acknowledgement when nothing is cancelable.
- Provide a cleanup hook registry that definitely runs before the interruption message is yielded.
- Change queue application ordering semantics or submit-interrupt behavior itself.

## Implementation decision for this issue

This issue should stay non-trunk. I will implement the three UI-only fixes:

1. explicit queued badge in the prompt preview,
2. explicit redirect marker in the transcript,
3. more specific cancel acknowledgement copy.

I will not attempt cleanup-registry wiring or trunk-owned cancel guarantees in this issue.
