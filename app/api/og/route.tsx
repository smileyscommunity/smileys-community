import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const rawTitle = searchParams.get('title')?.trim()
    const eyebrow  = searchParams.get('eyebrow')?.trim() || 'Istanbul Handbook'
    // Defaults to the handbook's original CTA so every existing caller
    // (handbook articles that never passed this param) renders identically.
    const cta      = searchParams.get('cta')?.trim() || 'Read the handbook'

    // Title card — passed by handbook articles that have no cover image, so
    // each shared link gets a tailored preview (article title + category)
    // instead of the generic brand card below. Headline shrinks as the title
    // grows so it always fits 1200×630, and long titles are clamped.
    if (rawTitle) {
      const title    = rawTitle.length > 110 ? `${rawTitle.slice(0, 107)}…` : rawTitle
      const fontSize = title.length > 70 ? 54 : title.length > 45 ? 66 : 80
      return new ImageResponse(
        (
          <div
            style={{
              height: '100%',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              padding: '70px',
              backgroundColor: '#fef3c7',
              backgroundImage: 'linear-gradient(to bottom right, #fef3c7, #fed7aa)',
              fontFamily: 'sans-serif',
            }}
          >
            {/* Brand lockup */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ fontSize: '48px' }}>😊</div>
              <div style={{ fontSize: '28px', fontWeight: 700, color: '#b45309' }}>
                Smileys Community
              </div>
            </div>

            {/* Eyebrow + title */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div
                style={{
                  display: 'flex',
                  fontSize: '24px',
                  fontWeight: 700,
                  color: '#b45309',
                  textTransform: 'uppercase',
                  letterSpacing: '3px',
                  marginBottom: '18px',
                }}
              >
                {eyebrow}
              </div>
              <div
                style={{
                  display: 'flex',
                  fontSize: `${fontSize}px`,
                  fontWeight: 800,
                  color: '#7c2d12',
                  lineHeight: 1.12,
                }}
              >
                {title}
              </div>
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '24px', color: '#92400e' }}>smileyscommunity.com</div>
              <div
                style={{
                  display: 'flex',
                  padding: '12px 28px',
                  borderRadius: '24px',
                  backgroundColor: '#f59e0b',
                  color: 'white',
                  fontSize: '22px',
                  fontWeight: 700,
                }}
              >
                {cta}
              </div>
            </div>
          </div>
        ),
        {
          width: 1200,
          height: 630,
        }
      )
    }

    // Generic brand card — param-less default (events cover-image fallback,
    // and any other caller that just wants the Smileys OG image).
    return new ImageResponse(
      (
        <div
          style={{
            height: '100%',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#fef3c7',
            backgroundImage: 'linear-gradient(to bottom right, #fef3c7, #fed7aa)',
            fontFamily: 'sans-serif',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '180px',
              height: '180px',
              borderRadius: '90px',
              backgroundColor: 'rgba(245, 158, 11, 0.1)',
              marginBottom: '20px',
            }}
          >
            <div style={{ fontSize: '100px' }}>😊</div>
          </div>
          <div
            style={{
              fontSize: '72px',
              fontWeight: 800,
              color: '#92400e',
              marginBottom: '10px',
            }}
          >
            Smileys Community
          </div>
          <div
            style={{
              fontSize: '32px',
              color: '#b45309',
              marginBottom: '40px',
            }}
          >
            Curated city communities
          </div>
          <div
            style={{
              display: 'flex',
              padding: '16px 40px',
              borderRadius: '30px',
              backgroundColor: '#f59e0b',
              color: 'white',
              fontSize: '28px',
              fontWeight: 700,
            }}
          >
            Join the community
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
      }
    )
  } catch (e: any) {
    console.error(e.message)
    return new Response(`Failed to generate the image`, {
      status: 500,
    })
  }
}
