import { describe, expect, test } from 'bun:test'
import React from 'react'
import { FallbackToolUseRejectedMessage } from '../../components/FallbackToolUseRejectedMessage.js'
import { renderToString } from '../../utils/staticRender.js'
import {
  extractQueuedCommandText,
  formatQueuedPreviewContent,
  getCancelAcknowledgementLabel,
  getQueuedMessageBadgeLabel,
  getRedirectedMarkerLabel,
  shouldShowQueuedMessageBadge,
  shouldShowRedirectedMarker,
} from './presentation.js'

describe('interrupt presentation helpers', () => {
  test('distinguishes request and tool cancellation copy', () => {
    expect(getCancelAcknowledgementLabel('request')).toBe(
      'Interrupted response',
    )
    expect(getCancelAcknowledgementLabel('tool')).toBe(
      'Interrupted tool run',
    )
  })

  test('shows queue-preview chrome only for human prompt redirects', () => {
    expect(
      shouldShowQueuedMessageBadge({
        mode: 'prompt',
        isMeta: false,
        origin: undefined,
      }),
    ).toBe(true)

    expect(
      shouldShowQueuedMessageBadge({
        mode: 'task-notification',
        isMeta: false,
        origin: undefined,
      }),
    ).toBe(false)

    expect(
      shouldShowQueuedMessageBadge({
        mode: 'prompt',
        isMeta: true,
        origin: undefined,
      }),
    ).toBe(false)
  })

  test('shows redirected marker only for replayed human prompts', () => {
    expect(
      shouldShowRedirectedMarker({
        mode: 'prompt',
        isMeta: false,
        origin: undefined,
      }),
    ).toBe(true)

    expect(
      shouldShowRedirectedMarker({
        mode: 'prompt',
        isMeta: true,
        origin: undefined,
      }),
    ).toBe(false)

    expect(
      shouldShowRedirectedMarker({
        mode: 'prompt',
        isMeta: false,
        origin: { kind: 'task-notification' },
      }),
    ).toBe(false)
  })

  test('formats queue badge text as a trimmed single line', () => {
    expect(
      getQueuedMessageBadgeLabel(
        '  explain why\nthis queued prompt should wrap neatly  ',
      ),
    ).toBe('queued: explain why this queued prompt should wrap neatly')

    expect(
      getQueuedMessageBadgeLabel(
        'x'.repeat(80),
      ),
    ).toBe(`queued: ${'x'.repeat(57)}...`)

    expect(getQueuedMessageBadgeLabel('   ')).toBe('queued: (empty)')
  })

  test('prefixes queued preview content inline for visible queued prompts', () => {
    expect(
      formatQueuedPreviewContent('hello from queue', {
        mode: 'prompt',
        isMeta: false,
        origin: undefined,
      }),
    ).toBe('queued: hello from queue')

    expect(
      formatQueuedPreviewContent(
        'line one\nline two\n' + 'x'.repeat(80),
        {
          mode: 'prompt',
          isMeta: false,
          origin: undefined,
        },
      ),
    ).toBe(`queued: line one\nline two\n${'x'.repeat(80)}`)

    expect(
      formatQueuedPreviewContent(
        [{ type: 'text', text: 'hello from queue' }],
        {
          mode: 'prompt',
          isMeta: false,
          origin: undefined,
        },
      ),
    ).toEqual([{ type: 'text', text: 'queued: hello from queue' }])
  })

  test('renders tool-scoped cancellation copy for fallback rejection UI', async () => {
    const rendered = await renderToString(
      React.createElement(FallbackToolUseRejectedMessage),
    )
    expect(rendered).toContain('Interrupted tool run')
    expect(rendered).not.toContain('Interrupted response')
  })

  test('extracts text from content blocks and exposes the redirect marker', () => {
    expect(
      extractQueuedCommandText([
        { type: 'text', text: 'first line' },
        { type: 'text', text: 'second line' },
      ]),
    ).toContain('first line')
    expect(getRedirectedMarkerLabel()).toBe('-> redirected')
  })
})
