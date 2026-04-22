---
description: Create a durable reminder for this project.
argument-hint: <time> | <text>
allowed-tools: Bash
---

Schedule the reminder for the current project and reply with the exact output below. Do not add explanation.

```!
cat <<'EOF' | bun 'src 2/services/reminders/reminderCommandCli.ts'
$ARGUMENTS
EOF
```
