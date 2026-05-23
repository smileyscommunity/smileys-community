import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export async function GET() {
  try {
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
            Istanbul&apos;s curated social community
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
