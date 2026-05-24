import fs from 'fs'
import path from 'path'

const FILE = path.join(process.cwd(), 'data', 'content.json')

export function loadContent() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return {} }
}

