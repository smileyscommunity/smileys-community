export async function apiFetch(path: string, options: RequestInit = {}) {
  return fetch(path, { credentials: 'include', ...options })
}
