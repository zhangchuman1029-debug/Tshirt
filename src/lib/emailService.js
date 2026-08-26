export async function sendWelcomeEmail({ email, name, communityName = 'A&T club' }) {
  const endpoint = import.meta.env.VITE_EMAIL_ENDPOINT

  if (endpoint) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, communityName }),
    })

    if (!response.ok) throw new Error('welcome-email-failed')
    return { mode: 'live' }
  }

  await new Promise((resolve) => window.setTimeout(resolve, 500))
  return { mode: 'demo' }
}
