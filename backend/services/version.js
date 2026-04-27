/**
 * Источник версии для backend.
 *
 * При локальной разработке: читает VERSION из корня проекта и git rev-parse HEAD на старте.
 * В Docker: VERSION копируется в образ, BUILD_SHA/BUILD_DATE передаются как build-args
 *           и пробрасываются как ENV. Тогда git не нужен.
 *
 * Кешируется на старте — не меняется в течение жизни процесса.
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

let cached = null

function readVersionFile() {
  // Кандидаты в порядке приоритета:
  //   /VERSION           — куда кладёт Dockerfile (в корень файлсистемы)
  //   backend/VERSION    — если кто-то скопировал в папку backend
  //   ../VERSION         — корень проекта (для локального dev)
  const candidates = [
    '/VERSION',
    path.join(__dirname, '..', 'VERSION'),
    path.join(__dirname, '..', '..', 'VERSION'),
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return fs.readFileSync(p, 'utf8').trim()
      }
    } catch { /* ignore */ }
  }
  return '0.0.0-dev'
}

function getGitSha() {
  // В docker — приходит через ENV BUILD_SHA
  if (process.env.BUILD_SHA) return process.env.BUILD_SHA
  // Локально — пробуем git
  try {
    const sha = execSync('git rev-parse HEAD', {
      cwd: path.join(__dirname, '..', '..'),
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim()
    return sha
  } catch {
    return null
  }
}

function getGitShaShort() {
  const sha = getGitSha()
  return sha ? sha.slice(0, 7) : null
}

function getBuildDate() {
  // В docker — BUILD_DATE передаётся как build-arg
  if (process.env.BUILD_DATE) return process.env.BUILD_DATE
  // Локально — берём mtime файла VERSION
  try {
    const candidates = [
      path.join(__dirname, '..', 'VERSION'),
      path.join(__dirname, '..', '..', 'VERSION'),
    ]
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return fs.statSync(p).mtime.toISOString()
      }
    }
  } catch { /* ignore */ }
  return null
}

function getInfo() {
  if (cached) return cached
  cached = {
    version: readVersionFile(),
    sha: getGitSha(),
    shaShort: getGitShaShort(),
    buildDate: getBuildDate(),
    startedAt: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
  }
  return cached
}

module.exports = { getInfo, readVersionFile, getGitSha, getGitShaShort }
