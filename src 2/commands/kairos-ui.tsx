import * as React from 'react'
import { Select } from '../components/CustomSelect/select.js'
import { Dialog } from '../components/design-system/Dialog.js'
import { Box, Text } from '../ink.js'
import type { LocalJSXCommandCall, LocalJSXCommandOnDone } from '../types/command.js'
import { importSkill } from '../services/skillInterop/importSkill.js'
import { parseImportArgs } from './kairos-skills-interop.js'
import { runKairosCommand } from './kairos.js'

type ImportDialogProps = {
  args: string
  source: string
  overwrite: boolean
  onDone: LocalJSXCommandOnDone
}

function KairosCommandRunner({
  args,
  onDone,
}: {
  args: string
  onDone: LocalJSXCommandOnDone
}): React.ReactNode {
  const importArgs = getInteractiveImportArgs(args)

  React.useEffect(() => {
    if (importArgs) {
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const value = await runKairosCommand(args)
        if (!cancelled) {
          onDone(value, { display: 'system' })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!cancelled) {
          onDone(`kairos: ${message}`, { display: 'system' })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [args, importArgs, onDone])

  if (!importArgs) {
    return null
  }

  return (
    <KairosSkillImportDialog
      args={args}
      source={importArgs.source}
      overwrite={importArgs.overwrite}
      onDone={onDone}
    />
  )
}

function KairosSkillImportDialog({
  args,
  source,
  overwrite,
  onDone,
}: ImportDialogProps): React.ReactNode {
  const [preview, setPreview] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const value = await importSkill(source, {
          confirm: false,
          overwrite,
        })
        if (!cancelled) {
          setPreview(value)
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [overwrite, source])

  const handleCancel = React.useCallback(() => {
    onDone('Cancelled skill import.', { display: 'system' })
  }, [onDone])

  const handleChoice = React.useCallback(
    async (value: 'import' | 'cancel') => {
      if (value === 'cancel') {
        handleCancel()
        return
      }

      setIsSubmitting(true)
      try {
        const result = await runKairosCommand(`${args} --yes`)
        onDone(result, { display: 'system' })
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        onDone(`kairos: ${message}`, { display: 'system' })
      }
    },
    [args, handleCancel, onDone],
  )

  const title = overwrite ? 'Overwrite imported skill?' : 'Import skill?'
  const subtitle = source

  if (error) {
    return (
      <Dialog title={title} subtitle={subtitle} onCancel={handleCancel} color="warning">
        <Text color="error">{error}</Text>
      </Dialog>
    )
  }

  if (!preview) {
    return (
      <Dialog title={title} subtitle={subtitle} onCancel={handleCancel}>
        <Text dimColor>Loading import preview…</Text>
      </Dialog>
    )
  }

  const options = [
    {
      label: overwrite ? 'Overwrite skill' : 'Import skill',
      value: 'import' as const,
      disabled: isSubmitting,
    },
    {
      label: 'Cancel',
      value: 'cancel' as const,
      disabled: isSubmitting,
    },
  ]

  return (
    <Dialog title={title} subtitle={subtitle} onCancel={handleCancel}>
      <Box flexDirection="column" gap={1}>
        {preview.split('\n').map((line, index) => (
          <Text key={index}>{line.length > 0 ? line : ' '}</Text>
        ))}
        <Select onChange={handleChoice} options={options} />
      </Box>
    </Dialog>
  )
}

function getInteractiveImportArgs(args: string): {
  source: string
  overwrite: boolean
} | null {
  const trimmed = args.trim()
  if (!trimmed.startsWith('skills import ')) {
    return null
  }

  const parsed = parseImportArgs(trimmed.slice('skills import '.length))
  if (!parsed.source || parsed.confirm) {
    return null
  }

  return {
    source: parsed.source,
    overwrite: parsed.overwrite,
  }
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  return <KairosCommandRunner args={args} onDone={onDone} />
}
