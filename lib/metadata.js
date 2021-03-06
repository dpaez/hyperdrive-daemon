const p = require('path')
const fs = require('fs-extra')

const sodium = require('sodium-universal')
const mkdirp = require('mkdirp')

const constants = require('hyperdrive-daemon-client/lib/constants')

async function createMetadata (storage, endpoint) {
  var token = constants.env.token
  if (!token) {
    const rnd = Buffer.allocUnsafe(64)
    sodium.randombytes_buf(rnd)
    token = rnd.toString('hex')
  }
  await new Promise((resolve, reject) => {
    mkdirp(storage, err => {
      if (err) return reject(err)
      return resolve()
    })
  })

  const metadataPath = p.join(storage, 'config.json')
  const metadata = { token, endpoint }
  await fs.writeFile(metadataPath, JSON.stringify(metadata))
  return metadata
}

async function deleteMetadata () {
  return fs.unlink(constants.metadata)
}

module.exports = {
  createMetadata,
  deleteMetadata
}
