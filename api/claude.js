export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { prompt, system } = req.body
  if (!prompt) return res.status(400).json({ error: 'prompt is required' })

  const apiKey = process.env.ANTHROPIC_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_KEY not configured on server' })

  // Strip any accidental whitespace or quotes from the key
  const cleanKey = apiKey.trim().replace(/^['"]|['"]$/g, '')

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cleanKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        system: system || 'You are a senior TapClicks implementation consultant writing professional SRD documents. Write concisely and specifically. No markdown formatting, no asterisks, no hashtags. Plain text only.',
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const data = await response.json()

    if (!response.ok || data.error) {
      return res.status(400).json({ 
        error: data.error?.message || 'Anthropic API error',
        type: data.error?.type,
        status: response.status
      })
    }

    const text = data.content?.find(b => b.type === 'text')?.text?.trim() || ''
    return res.status(200).json({ text })

  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
