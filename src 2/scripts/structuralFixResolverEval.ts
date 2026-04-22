import { join } from 'node:path'
import {
  evaluateStructuralFixResolver,
  readStructuralFixResolver,
  readStructuralFixResolverEvals,
} from '../services/structuralFix/structuralFix.js'

async function main(): Promise<void> {
  const projectDir = join(process.cwd(), '..')
  const [resolver, suite] = await Promise.all([
    readStructuralFixResolver(projectDir),
    readStructuralFixResolverEvals(projectDir),
  ])
  const evaluation = evaluateStructuralFixResolver(resolver, suite)

  if (evaluation.failed.length > 0) {
    console.error(JSON.stringify(evaluation, null, 2))
    process.exitCode = 1
    return
  }

  console.log(
    JSON.stringify(
      {
        skill: resolver.skill,
        passed: evaluation.passed,
        total: evaluation.total,
      },
      null,
      2,
    ),
  )
}

void main()
