export const BROWSER_HARNESS_SKILL_BODY = `# browser-harness

Use this skill only for opt-in real-browser work against the user's already-running local browser. Prefer normal HTTP or WebBrowser-style tools for docs, static fetches, and local dev inspection. Switch to Browser Harness when the task truly needs the user's browser session, such as logged-in flows, uploads, OAuth, or dynamic UI behavior that ordinary web tools cannot reliably handle.

## Operating rules

1. Read \`setup.md\` first if install, bootstrap, reconnect, or attach health might matter.
2. Read \`trust-model.md\` before touching accounts, uploads, purchases, settings, or other stateful actions.
3. Tell the user explicitly when you are switching from normal tools to Browser Harness so they understand their real browser is in use.
4. Use the Browser Harness executable through the Bash tool. Do not claim browser control is active unless the command actually runs.
5. When Browser Harness is no longer needed, say so explicitly and go back to normal tools.

## Command shape

\`\`\`bash
browser-harness <<'PY'
new_tab("https://example.com")
wait_for_load()
print(page_info())
PY
\`\`\`

## Day-to-day guidance

- The first navigation in a fresh task should usually be \`new_tab(url)\`, not \`goto(url)\`.
- Use \`browser-harness --doctor\` to diagnose install, daemon, or browser attach problems.
- Use \`browser-harness --setup\` for attach or reconnect flows.
- Use \`browser-harness --update -y\` when the harness itself reports an available update.
- Read \`helpers.py\` in the installed harness repo before inventing new helper behavior.
- If setup is incomplete, explain the missing prerequisite clearly instead of pretending the browser is connected.`

export const BROWSER_HARNESS_SKILL_FILES: Record<string, string> = {
  'setup.md': `# Browser Harness setup

This integration is optional. Nothing changes unless the user explicitly enables it for the session.

## Opt-in

Enable the integration with:

- \`CLAUDE_CODE_ENABLE_BROWSER_HARNESS=1\`

You can export that in the shell before starting the CLI, or place it under the CLI's normal \`env\` settings so future sessions inherit it.

If the executable is not on \`PATH\`, point Claude Code at it explicitly:

- \`CLAUDE_CODE_BROWSER_HARNESS_PATH=/absolute/path/to/browser-harness\`

## Recommended install flow

Clone Browser Harness into a durable location and install it as an editable tool so the \`browser-harness\` command works from any project:

\`\`\`bash
git clone https://github.com/browser-use/browser-harness ~/Developer/browser-harness
cd ~/Developer/browser-harness
uv tool install -e .
command -v browser-harness
\`\`\`

That keeps the command global while still pointing at the real repo checkout, so edits to \`helpers.py\` take effect immediately on the next run.

## First attach / reconnect

Prefer the built-in setup path:

\`\`\`bash
browser-harness --setup
\`\`\`

Use the doctor command when setup is incomplete or a previously working attach goes stale:

\`\`\`bash
browser-harness --doctor
\`\`\`

If the harness still cannot attach, fall back to the upstream install docs and follow the attach steps there. Do not silently assume browser control is active.

## Verification

After setup, verify the local browser path with one small task:

\`\`\`bash
browser-harness <<'PY'
new_tab("https://browser-use.com")
wait_for_load()
print(page_info())
PY
\`\`\`

If that succeeds, Browser Harness is ready for real tasks in the user's local browser.`,
  'trust-model.md': `# Browser Harness trust model

Browser Harness talks to the user's real local browser over CDP. Treat it as a high-trust capability.

## What it can do

- Read and interact with pages already open in the user's browser
- Reuse logged-in state from the user's normal browser profile
- Click, type, upload files, navigate, and inspect page state
- Perform actions that are impossible or unreliable through plain HTTP fetches

## Safety baseline

- Say explicitly when Browser Harness is active
- Use it only when the task actually needs the user's real browser
- Ask before account-mutating, destructive, or purchase-like actions
- Do not keep retrying the same risky browser action once the state looks ambiguous
- If setup is incomplete or attach fails, say so clearly and stop pretending the browser is connected

## Fallback rule

If normal web tools are enough, do not use Browser Harness. This integration exists for the narrow class of tasks where real browser state is necessary.`,
}
