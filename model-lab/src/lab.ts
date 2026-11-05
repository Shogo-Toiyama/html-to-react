// Model lab: run the workshop's AI steps with different models and compare them.
//
//   npm run baseline                       Sonnet runs all 4 steps in a row; each step's input is saved
//   npm run try -- --model haiku           run Haiku on those same saved inputs
//   npm run try -- --model haiku --steps components,tailwind-cleanup --runs 3
//   npm run report                         table of everything in runs/
//
// Every result project is written to runs/<model>/<step>-<n>/project, so you can
// `npm install && npm run dev` inside it to look at the page.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AiStep } from '../../frontend/src/lib/aiApi'
import { callModel, type CallResult } from './call'
import { applySuggestion, buildRequest, copyProject, readProject, setupTailwind } from './project'

try {
  process.loadEnvFile(join(import.meta.dirname, '..', '.env'))
} catch {
  // Using the environment's ANTHROPIC_API_KEY.
}

const ROOT = join(import.meta.dirname, '..')
const RUNS = join(ROOT, 'runs')
/** The converter's output for the sample site: what a participant starts Step 2 with. */
const START = join(ROOT, '..', 'frontend', 'src', 'converter', '__snapshots__', 'acm-design')
const STEPS: AiStep[] = ['components', 'props', 'tailwind', 'tailwind-cleanup']
const ALIASES: Record<string, string> = { sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' }
const BASELINE = 'claude-sonnet-5-5'

const [command = '', ...rest] = process.argv.slice(2)
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`)
  return i === -1 ? undefined : rest[i + 1]
}
const stageName = (step: AiStep) => `${STEPS.indexOf(step) + 1}-${step}`
const slug = (model: string) => model.replace(/[^a-z0-9.-]/gi, '_')

function save(dir: string, result: CallResult, same: string) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'result.json'), JSON.stringify({ ...result, vsBaseline: same }, null, 2))
}

async function baseline() {
  const out = join(RUNS, 'baseline')
  if (existsSync(out)) {
    if (!rest.includes('--force')) throw new Error('runs/baseline already exists. Use --force to redo it (costs money).')
    rmSync(out, { recursive: true })
  }
  let current = join(out, 'start')
  copyProject(START, current)
  for (const step of STEPS) {
    const stage = join(out, stageName(step))
    const input = join(stage, 'input')
    copyProject(current, input)
    if (step === 'tailwind') setupTailwind(input)
    process.stdout.write(`baseline ${step}… `)
    const request = buildRequest(input, step, step === 'tailwind' ? '*' : undefined)
    const result = await callModel(BASELINE, request)
    console.log(describe(result))
    save(stage, result, '-')
    const project = join(stage, 'project')
    copyProject(input, project)
    if (result.suggestion) applySuggestion(project, result.suggestion)
    current = project
  }
  console.log(`\nSaved to ${out}. Now: npm run try -- --model haiku`)
}

async function tryModel() {
  const model = ALIASES[flag('model') ?? ''] ?? flag('model')
  if (!model) throw new Error('Pass --model haiku (or a full model id).')
  const steps = (flag('steps')?.split(',') as AiStep[] | undefined) ?? STEPS
  const runs = Number(flag('runs') ?? 1)
  /** Number of the first run, so more runs can be added without overwriting earlier ones. */
  const first = Number(flag('from') ?? 1)
  for (const step of steps) {
    const stage = join(RUNS, 'baseline', stageName(step))
    if (!existsSync(join(stage, 'input'))) throw new Error(`No baseline for ${step}. Run npm run baseline first.`)
    const request = buildRequest(join(stage, 'input'), step, step === 'tailwind' ? '*' : undefined)
    const reference = readProject(join(stage, 'project'))
    for (let n = first; n < first + runs; n++) {
      process.stdout.write(`${model} ${step} #${n}… `)
      const result = await callModel(model, request)
      const dir = join(RUNS, slug(model), `${stageName(step)}-${n}`)
      const project = join(dir, 'project')
      rmSync(dir, { recursive: true, force: true })
      copyProject(join(stage, 'input'), project)
      if (result.suggestion) applySuggestion(project, result.suggestion)
      const same = compare(reference, readProject(project))
      save(dir, result, same)
      console.log(`${describe(result)}  | vs Sonnet: ${same}`)
    }
  }
  report()
}

/** How close two projects are, by file contents. Not a visual check: look at the page for that. */
function compare(a: Map<string, string>, b: Map<string, string>): string {
  const paths = new Set([...a.keys(), ...b.keys()])
  let identical = 0
  const different: string[] = []
  for (const path of paths) {
    if (a.get(path) === b.get(path)) identical++
    else different.push(path)
  }
  return `${identical}/${paths.size} files identical${different.length ? ` (differs: ${different.join(', ')})` : ''}`
}

function status(r: CallResult): string {
  if (r.failure) return `FAILED (${r.failure})`
  if (r.errors.length) return `invalid (${r.errors.length} problems)`
  return r.firstErrors.length ? 'ok after fix-up' : 'ok first try'
}

function describe(r: CallResult): string {
  return `${status(r)}, ${r.seconds.toFixed(0)}s, $${r.usage.costUsd.toFixed(4)}, out ${r.usage.outputTokens} tok`
}

function report() {
  if (!existsSync(RUNS)) return console.log('No runs yet.')
  const rows: string[][] = [['model', 'step', 'result', 'sec', 'cost $', 'out tok', 'vs Sonnet']]
  for (const model of readdirSync(RUNS).sort()) {
    for (const run of readdirSync(join(RUNS, model)).sort()) {
      if (run === 'start') continue
      addRow(rows, model === 'baseline' ? 'sonnet (baseline)' : model, join(RUNS, model, run))
    }
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].length)))
  console.log('\n' + rows.map((row) => row.map((cell, i) => cell.padEnd(widths[i])).join('  ')).join('\n'))
}

function addRow(rows: string[][], label: string, dir: string) {
  const file = join(dir, 'result.json')
  if (!existsSync(file)) return
  const r = JSON.parse(readFileSync(file, 'utf8')) as CallResult & { vsBaseline: string }
  const result = r.errors.length ? `${status(r)}: ${r.errors[0]}` : status(r)
  rows.push([label, dir.split('/').at(-1)!, result, r.seconds.toFixed(0), r.usage.costUsd.toFixed(4), String(r.usage.outputTokens), r.vsBaseline])
}

if (command === 'baseline') await baseline()
else if (command === 'try') await tryModel()
else if (command === 'report') report()
else console.log('Usage: npm run baseline | npm run try -- --model haiku [--steps a,b] [--runs N] | npm run report')
