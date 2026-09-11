import { toast } from 'sonner'

// Admin handlers checked `res.ok` and did nothing otherwise, so a refused
// request — including the step-up 403 whose message tells the admin what to
// do (lib/stepUp) — looked like a button that did nothing. One place to
// surface the server's reason, with a fallback for non-JSON (nginx 502).
export async function toastApiError(res: Response, fallback: string): Promise<void> {
  let message = fallback
  try {
    const data = await res.json()
    if (typeof data?.error === 'string' && data.error) message = data.error
  } catch {}
  toast.error(message)
}
