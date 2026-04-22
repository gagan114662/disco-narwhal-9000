import { join } from 'node:path'
import {
  setCwdState,
  setOriginalCwd,
  setProjectRoot,
} from '../bootstrap/state.js'
import { runStructuralFixSmoke } from '../services/structuralFix/structuralFix.js'

async function main(): Promise<void> {
  const projectRoot = join(process.cwd(), '..')
  setOriginalCwd(projectRoot)
  setCwdState(projectRoot)
  setProjectRoot(projectRoot)

  const report = await runStructuralFixSmoke(projectRoot)
  console.log(JSON.stringify(report, null, 2))
}

void main()
