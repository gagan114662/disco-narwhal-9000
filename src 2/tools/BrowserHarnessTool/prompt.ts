export const BROWSER_HARNESS_TOOL_NAME = 'BrowserHarness'

export const DESCRIPTION =
  'Execute a browser-harness script against the user\'s real browser (opt-in)'

export const BROWSER_HARNESS_TOOL_PROMPT = `Run a Python script through the locally-installed \`browser-harness\` CLI.

Browser Harness (https://github.com/browser-use/browser-harness) attaches to the user's running Chrome over CDP. This tool is a thin, explicit opt-in bridge: it spawns \`browser-harness\`, pipes \`script\` to its stdin, and returns the captured stdout/stderr.

Preconditions — all must hold or the tool will error out without touching the browser:
- \`browserHarness.enabled\` is \`true\` in settings.
- The \`browser-harness\` command (or the configured \`browserHarness.command\`) is on \`$PATH\`. Install via \`git clone https://github.com/browser-use/browser-harness && cd browser-harness && uv tool install -e .\`.
- The user has completed the one-time Chrome remote-debugging setup described in the browser-harness install guide.

\`script\` is the full Python payload that would normally be piped into \`browser-harness <<'PY' ... PY\`. Helpers like \`new_tab\`, \`goto\`, \`page_info\`, and \`wait_for_load\` are pre-imported by the harness.

Use this tool only when a real browser session is required (logged-in sites, uploads, messy UI flows) — prefer normal HTTP tools otherwise. The tool never activates the browser implicitly; the opt-in settings flag is the single control.`
