import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'

export const runtime = 'edge'

// Link-preview image for a hangout: the hangout's own photo full-bleed with a
// "HANGOUT" badge overlaid, so shares are unmistakably a hangout. The photo is
// passed as an absolute ?photo= URL (built in the page's generateMetadata) so
// this route needs no DB and can stay on the edge. No photo → branded fallback.
export async function GET(req: NextRequest) {
  const photo = req.nextUrl.searchParams.get('photo') || ''

  const Badge = (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: '14px',
        padding: '16px 34px', borderRadius: '999px',
        backgroundColor: '#f59e0b', color: 'white',
        fontSize: '46px', fontWeight: 800, letterSpacing: '4px',
        boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
      }}
    >
      🎈 HANGOUT
    </div>
  )

  try {
    return new ImageResponse(
      (
        <div style={{ position: 'relative', width: '1200px', height: '630px', display: 'flex', backgroundColor: '#b45309', fontFamily: 'sans-serif' }}>
          {photo
            ? <img src={photo} width={1200} height={630} style={{ position: 'absolute', top: 0, left: 0, width: '1200px', height: '630px', objectFit: 'cover' }} />
            : <div style={{ position: 'absolute', top: 0, left: 0, width: '1200px', height: '630px', display: 'flex', backgroundImage: 'linear-gradient(135deg, #f59e0b, #b45309)' }} />}

          {/* Legibility gradient */}
          <div style={{ position: 'absolute', top: 0, left: 0, width: '1200px', height: '630px', display: 'flex', backgroundImage: 'linear-gradient(to bottom, rgba(0,0,0,0.20) 0%, rgba(0,0,0,0) 34%, rgba(0,0,0,0.55) 100%)' }} />

          {/* HANGOUT badge, top-left */}
          <div style={{ position: 'absolute', top: '46px', left: '46px', display: 'flex' }}>{Badge}</div>

          {/* Smileys wordmark, bottom-right */}
          <div style={{ position: 'absolute', bottom: '42px', right: '50px', display: 'flex', alignItems: 'center', gap: '12px', color: 'white', fontSize: '40px', fontWeight: 700, textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}>
            😊 Smileys
          </div>
        </div>
      ),
      { width: 1200, height: 630 },
    )
  } catch (e: any) {
    console.error('[og/hangout]', e?.message)
    // Photo failed to load — branded, text-only fallback still carrying HANGOUT.
    return new ImageResponse(
      (
        <div style={{ width: '1200px', height: '630px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fef3c7', backgroundImage: 'linear-gradient(to bottom right, #fef3c7, #fed7aa)', fontFamily: 'sans-serif' }}>
          {Badge}
          <div style={{ display: 'flex', marginTop: '26px', color: '#92400e', fontSize: '38px', fontWeight: 700 }}>😊 Smileys Community</div>
        </div>
      ),
      { width: 1200, height: 630 },
    )
  }
}
