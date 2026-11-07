function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const doGet = (u, depth) => {
      if (depth > 5) return reject(new Error('Too many redirects'))
      const mod = u.startsWith('https') ? require('https') : require('http')
      mod.get(u, { headers: { 'User-Agent': 'TruckersMP-Launcher' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          return doGet(new URL(res.headers.location, u).href, depth + 1)
        }
        const chunks = []
        res.on('data', c => chunks.push(c))
        res.on('end', () => {
          const body = Buffer.concat(chunks)
          if (res.statusCode < 200 || res.statusCode >= 300) {
            let message = ''
            try { message = JSON.parse(body.toString()).message || '' } catch {}
            const rateLimited = res.statusCode === 429 ||
              (res.statusCode === 403 && (res.headers['x-ratelimit-remaining'] === '0' || /rate limit/i.test(message)))
            if (rateLimited) {
              const reset = Number(res.headers['x-ratelimit-reset'])
              const retry = Number.isFinite(reset) && reset > 0
                ? ` Try again after ${new Date(reset * 1000).toLocaleString()}.`
                : ' Try again later.'
              return reject(new Error(`GitHub API rate limit reached for your network.${retry}`))
            }
            return reject(new Error(`HTTP ${res.statusCode}${message ? ': ' + message : ''}`))
          }
          resolve(body)
        })
        res.on('error', reject)
      }).on('error', reject)
    }
    doGet(url, 0)
  })
}

module.exports={httpsGet}
