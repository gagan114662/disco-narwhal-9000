export type SuspiciousPatternHit = {
  id: string
  label: string
}

const SUSPICIOUS_PATTERNS: Array<{
  id: string
  label: string
  pattern: RegExp
}> = [
  {
    id: 'rm-rf-root',
    label: 'Contains destructive `rm -rf` command',
    pattern: /\brm\s+-rf\s+(\/|~\/|\$HOME\b)/i,
  },
  {
    id: 'sudo',
    label: 'Contains `sudo`',
    pattern: /\bsudo\b/i,
  },
  {
    id: 'curl-pipe-shell',
    label: 'Pipes `curl` output into a shell',
    pattern: /\bcurl\b[^\n|]*\|\s*(sh|bash|zsh)\b/i,
  },
  {
    id: 'wget-pipe-shell',
    label: 'Pipes `wget` output into a shell',
    pattern: /\bwget\b[^\n|]*\|\s*(sh|bash|zsh)\b/i,
  },
  {
    id: 'powershell-iex',
    label: 'Contains PowerShell `iex` / `Invoke-Expression` execution',
    pattern: /\b(iex|invoke-expression)\b/i,
  },
  {
    id: 'mkfs',
    label: 'Contains filesystem formatting command',
    pattern: /\bmkfs(\.[a-z0-9]+)?\b/i,
  },
  {
    id: 'dd-disk',
    label: 'Contains raw disk copy command',
    pattern: /\bdd\s+if=/i,
  },
  {
    id: 'chmod-777',
    label: 'Contains broad `chmod 777` permission change',
    pattern: /\bchmod\s+777\b/i,
  },
]

export function scanSuspiciousSkillContent(
  content: string,
): SuspiciousPatternHit[] {
  return SUSPICIOUS_PATTERNS.filter(entry => entry.pattern.test(content)).map(
    entry => ({
      id: entry.id,
      label: entry.label,
    }),
  )
}
