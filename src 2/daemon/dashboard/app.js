const elements = {
  connectionPill: document.getElementById('connection-pill'),
  pauseButton: document.getElementById('pause-button'),
  resumeButton: document.getElementById('resume-button'),
  optInButton: document.getElementById('opt-in-button'),
  optOutButton: document.getElementById('opt-out-button'),
  demoButton: document.getElementById('demo-button'),
  projectDirInput: document.getElementById('project-dir-input'),
  projectSelect: document.getElementById('project-select'),
  flash: document.getElementById('flash'),
  projectCount: document.getElementById('project-count'),
  generatedAt: document.getElementById('generated-at'),
  globalSummary: document.getElementById('global-summary'),
  projectSummary: document.getElementById('project-summary'),
  selectedProjectLabel: document.getElementById('selected-project-label'),
  globalEvents: document.getElementById('global-events'),
  daemonLog: document.getElementById('daemon-log'),
  projectLog: document.getElementById('project-log'),
  projectEvents: document.getElementById('project-events'),
}

let snapshot = null
let selectedProjectDir = ''

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

const DAEMON_STATE_LABELS = {
  starting: 'Starting',
  idle: 'Ready',
  stopped: 'Stopped',
}

function formatDaemonState(value) {
  if (!value) return '—'
  return DAEMON_STATE_LABELS[value] ?? String(value)
}

function renderCards(target, entries, emptyText) {
  if (entries.length === 0) {
    target.classList.add('empty-state')
    target.textContent = emptyText
    return
  }
  target.classList.remove('empty-state')
  target.innerHTML = entries
    .map(
      ([label, value]) => `
        <div class="summary-card">
          <strong>${label}</strong>
          <span>${formatValue(value)}</span>
        </div>
      `,
    )
    .join('')
}

function pretty(value) {
  return JSON.stringify(value ?? [], null, 2)
}

function currentProject() {
  if (!snapshot) return null
  return (
    snapshot.projects.find(project => project.projectDir === selectedProjectDir) ??
    snapshot.projects[0] ??
    null
  )
}

function syncProjectOptions() {
  const projects = snapshot?.global.projects ?? []
  const options = projects
    .map(projectDir => `<option value="${projectDir}">${projectDir}</option>`)
    .join('')
  elements.projectSelect.innerHTML =
    options || '<option value="">No opted-in projects</option>'

  if (!selectedProjectDir || !projects.includes(selectedProjectDir)) {
    selectedProjectDir = projects[0] ?? ''
  }
  elements.projectSelect.value = selectedProjectDir
}

function renderSnapshot(nextSnapshot) {
  snapshot = nextSnapshot
  syncProjectOptions()
  const project = currentProject()

  elements.generatedAt.textContent = new Date(snapshot.generatedAt).toLocaleString()
  elements.projectCount.textContent = `${snapshot.global.projects.length} opted in`
  elements.projectDirInput.placeholder =
    selectedProjectDir || '/absolute/path/to/project'

  renderCards(
    elements.globalSummary,
    [
      ['Daemon state', formatDaemonState(snapshot.global.status?.state)],
      ['PID', snapshot.global.status?.pid],
      ['Projects', snapshot.global.projects.length],
      ['Paused', snapshot.global.pause?.paused ?? false],
      ['Global cost', snapshot.global.costs?.totalUSD?.toFixed?.(4)],
      ['Runs', snapshot.global.costs?.runs],
    ],
    'No global state has been written yet.',
  )

  if (!project) {
    elements.selectedProjectLabel.textContent = 'No project selected'
    renderCards(
      elements.projectSummary,
      [],
      'Opt a project in to see per-project state, logs, costs, and events.',
    )
    elements.projectLog.textContent = '[]'
    elements.projectEvents.textContent = '[]'
  } else {
    elements.selectedProjectLabel.textContent = project.projectDir
    renderCards(
      elements.projectSummary,
      [
        ['Worker running', project.status?.running],
        ['Overlap pending', project.status?.dirty],
        ['Pending count', project.status?.pendingCount],
        ['Last event', project.status?.lastEvent],
        ['Project cost', project.costs?.totalUSD?.toFixed?.(4)],
        ['Queued tasks', project.tasks.length],
      ],
      'This project has no KAIROS state yet.',
    )
    elements.projectLog.textContent = pretty(project.log)
    elements.projectEvents.textContent = pretty(project.events)
  }

  elements.globalEvents.textContent = pretty(snapshot.global.events)
  elements.daemonLog.textContent = pretty(snapshot.global.stdoutLog)
}

function setConnectionState(text, live) {
  elements.connectionPill.textContent = text
  elements.connectionPill.className = `pill ${live ? 'live' : 'muted'}`
}

function flash(message) {
  elements.flash.textContent = message
  window.clearTimeout(flash.timer)
  flash.timer = window.setTimeout(() => {
    elements.flash.textContent = ''
  }, 4000)
}

async function post(path, payload = {}) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await response.json()
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed: ${response.status}`)
  }
  return body
}

async function refresh() {
  const response = await fetch('/api/state')
  const body = await response.json()
  renderSnapshot(body)
}

elements.projectSelect.addEventListener('change', event => {
  selectedProjectDir = event.target.value
  if (snapshot) renderSnapshot(snapshot)
})

elements.optInButton.addEventListener('click', async () => {
  const projectDir = elements.projectDirInput.value.trim()
  if (!projectDir) {
    flash('Enter a project path to opt in.')
    return
  }
  const nextSnapshot = await post('/api/projects/opt-in', { projectDir })
  elements.projectDirInput.value = ''
  flash(`Opted in ${projectDir}`)
  renderSnapshot(nextSnapshot)
})

elements.optOutButton.addEventListener('click', async () => {
  const projectDir = elements.projectDirInput.value.trim() || selectedProjectDir
  if (!projectDir) {
    flash('Choose a project to opt out.')
    return
  }
  const nextSnapshot = await post('/api/projects/opt-out', { projectDir })
  elements.projectDirInput.value = ''
  flash(`Opted out ${projectDir}`)
  renderSnapshot(nextSnapshot)
})

elements.demoButton.addEventListener('click', async () => {
  const projectDir = selectedProjectDir || elements.projectDirInput.value.trim()
  if (!projectDir) {
    flash('Choose a project before queueing a demo task.')
    return
  }
  const result = await post('/api/projects/demo', { projectDir })
  flash(`Queued demo task ${result.taskId} for ${projectDir}`)
  renderSnapshot(result.snapshot)
})

elements.pauseButton.addEventListener('click', async () => {
  renderSnapshot(await post('/api/pause'))
  flash('Paused KAIROS globally.')
})

elements.resumeButton.addEventListener('click', async () => {
  renderSnapshot(await post('/api/resume'))
  flash('Resumed KAIROS.')
})

const events = new EventSource('/api/events')
events.addEventListener('snapshot', event => {
  setConnectionState('Live SSE', true)
  renderSnapshot(JSON.parse(event.data))
})
events.addEventListener('error', () => {
  setConnectionState('Reconnecting...', false)
})

window.addEventListener('load', () => {
  void refresh().catch(error => {
    flash(error.message)
    setConnectionState('Unavailable', false)
  })
})
