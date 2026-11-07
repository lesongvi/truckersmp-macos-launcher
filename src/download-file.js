const fs = require('fs')
const https = require('https')
const {pipeline} = require('stream/promises')

function downloadFile(url, destination, onProgress = () => {}, label = 'Download') {
  return new Promise((resolve, reject) => {
    function get(address, depth) {
      if (depth > 5) { reject(new Error(`${label}: too many redirects.`)); return }
      let parsed
      try { parsed = new URL(address) } catch (err) { reject(err); return }
      if (parsed.protocol !== 'https:') { reject(new Error(`${label} requires HTTPS.`)); return }
      const req = https.get(parsed, {headers:{'User-Agent':'TruckersMP-Launcher'}}, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          try { get(new URL(res.headers.location, parsed).href, depth + 1) } catch (err) { reject(err) }
          return
        }
        if (res.statusCode !== 200) { res.resume(); reject(new Error(`${label} returned HTTP ${res.statusCode}.`)); return }
        const total = Number(res.headers['content-length']) || 0
        let received = 0
        res.on('data', chunk => { received += chunk.length; onProgress({phase:'downloading', received, total}) })
        pipeline(res, fs.createWriteStream(destination)).then(resolve, reject)
      })
      req.setTimeout(30000, () => req.destroy(new Error(`${label} timed out.`)))
      req.on('error', reject)
    }
    get(url, 0)
  })
}

module.exports = {downloadFile}
