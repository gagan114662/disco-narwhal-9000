import { stdin as input } from 'node:process'
import { runReminderCommand } from './reminderCommand.js'

async function readStdin(): Promise<string> {
  let raw = ''
  input.setEncoding('utf8')
  for await (const chunk of input) {
    raw += chunk
  }
  return raw.trim()
}

const args = await readStdin()
const message = await runReminderCommand(args, {
  projectDir: process.cwd(),
})

console.log(message)
