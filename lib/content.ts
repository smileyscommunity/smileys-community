import fs from 'fs'
import path from 'path'

const FILE = path.join(process.cwd(), 'data', 'content.json')

export function loadContent() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return {} }
}

export function getStats(content: ReturnType<typeof loadContent>) {
  return content.stats ?? [
    { value: '4,000+', label: 'Members' },
    { value: '500+',   label: 'Events hosted' },
    { value: '70+',    label: 'Active clubs' },
    { value: 'Weekly', label: 'Curated events' },
  ]
}
