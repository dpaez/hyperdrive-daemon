const test = require('tape')
const hypercoreCrypto = require('hypercore-crypto')
const { create } = require('./util/create')

test('can replicate a single drive between daemons', async t => {
  const { clients, cleanup } = await create(2)
  const firstClient = clients[0]
  const secondClient = clients[1]

  try {
    const drive1 = await firstClient.drive.get()
    await drive1.configureNetwork({ lookup: true, announce: true })

    const drive2 = await secondClient.drive.get({ key: drive1.key })

    await drive1.writeFile('hello', 'world')

    // 100 ms delay for replication.
    await delay(100)

    const replicatedContent = await drive2.readFile('hello')
    t.same(replicatedContent, Buffer.from('world'))
  } catch (err) {
    t.fail(err)
  }

  await cleanup()
  t.end()
})

test('can download a directory between daemons', async t => {
  const { clients, cleanup } = await create(2)
  const firstClient = clients[0]
  const secondClient = clients[1]

  try {
    const drive1 = await firstClient.drive.get()
    await drive1.configureNetwork({ lookup: true, announce: true })

    const drive2 = await secondClient.drive.get({ key: drive1.key })

    await drive1.writeFile('/a/1', 'hello')
    await drive1.writeFile('/a/2', 'world')
    await drive1.writeFile('/a/3', 'three')
    await drive1.writeFile('/a/4', 'four')
    await drive1.writeFile('/a/5', 'five')

    var { stats } = await drive1.stats()
    t.same(stats[0].content.totalBlocks, 5)
    t.same(stats[0].content.downloadedBlocks, 5)

    // 100 ms delay for replication.
    await delay(100)

    var { stats } = await drive2.stats()
    t.same(stats[0].content.totalBlocks, 5)

    // TODO: Uncomment after hypercore bug fix.
    // t.same(stats[0].content.downloadedBlocks, 0)

    var fileStats = await drive2.fileStats('/a/1')

    // TODO: Uncomment after hypercore bug fix.
    // t.same(fileStats.get('/a/1').downloadedBlocks, 0)

    const handle = await drive2.download('a')

    // 200 ms delay for download to complete.
    await delay(200)

    var { stats } = await drive2.stats()
    fileStats = await drive2.fileStats('a')
    t.same(stats[0].content.totalBlocks, 5)
    t.same(stats[0].content.downloadedBlocks, 5)
    t.same(fileStats.get('/a/1').downloadedBlocks, 1)
    t.same(fileStats.get('/a/2').downloadedBlocks, 1)
    t.same(fileStats.get('/a/3').downloadedBlocks, 1)
    t.same(fileStats.get('/a/4').downloadedBlocks, 1)
    t.same(fileStats.get('/a/5').downloadedBlocks, 1)
  } catch (err) {
    t.fail(err)
  }

  await cleanup()
  t.end()
})

test('can cancel an active download', async t => {
  const { clients, cleanup } = await create(2)
  const firstClient = clients[0]
  const secondClient = clients[1]

  try {
    const drive1 = await firstClient.drive.get()
    await drive1.configureNetwork({ lookup: true, announce: true })

    const drive2 = await secondClient.drive.get({ key: drive1.key })

    await writeFile(drive1, '/a/1', 50)
    await writeFile(drive1, '/a/2', 50)

    var fileStats = await drive2.fileStats('/a/1')
    // TODO: Uncomment after hypercore bug fix
    // t.same(fileStats.downloadedBlocks, 0)

    const handle = await drive2.download('a')
    await delay(100)
    await handle.destroy()

    // Wait to make sure that the download is not continuing.
    await delay(100)

    const { stats: totals } = await drive2.stats()
    fileStats = await drive2.fileStats('a')
    const contentTotals = totals[0].content
    t.true(contentTotals.downloadedBlocks < 100 && contentTotals.downloadedBlocks > 0)
    t.true(fileStats.get('/a/1').downloadedBlocks < 50 && fileStats.get('/a/1').downloadedBlocks > 0)
    t.true(fileStats.get('/a/2').downloadedBlocks < 50 && fileStats.get('/a/2').downloadedBlocks > 0)
  } catch (err) {
    t.fail(err)
  }

  await cleanup()
  t.end()

  async function writeFile (drive, name, numBlocks) {
    const writeStream = drive.createWriteStream(name)
    return new Promise((resolve, reject) => {
      writeStream.on('finish', resolve)
      writeStream.on('error', reject)
      for (let i = 0; i < numBlocks; i++) {
        writeStream.write(Buffer.alloc(1024 * 1024).fill('abcdefg'))
      }
      writeStream.end()
    })
  }
})

test('can replicate many mounted drives between daemons', async t => {
  const { clients, daemons, cleanup } = await create(2)
  console.time('many-mounts')
  const firstClient = clients[0]
  const secondClient = clients[1]
  const secondDaemon = daemons[1]

  const NUM_MOUNTS = 20

  try {
    const mounts = await createFirst()
    const second = await createSecond(mounts)
    await validate(mounts, second)
  } catch (err) {
    t.fail(err)
  }

  await cleanup()
  console.timeEnd('many-mounts')
  t.end()

  async function createFirst () {
    const rootDrive = await firstClient.drive.get()
    const mounts = []
    for (let i = 0; i < NUM_MOUNTS; i++) {
      const key = '' + i
      const mountDrive = await firstClient.drive.get()
      await rootDrive.mount(key, { key: mountDrive.key })
      await mountDrive.writeFile(key, key)
      await mountDrive.configureNetwork({ lookup: true, announce: true })
      mounts.push({ key: mountDrive.key, path: key + '/' + key, content: key })
    }
    return mounts
  }

  async function createSecond (mounts) {
    const rootDrive = await secondClient.drive.get()
    for (const { key, content } of mounts) {
      await secondClient.drive.get({ key })
      await rootDrive.mount(content, { key })
    }
    return rootDrive
  }

  async function validate (mounts, secondRoot) {
    const contents = await Promise.all(mounts.map(({ path, content }) => secondRoot.readFile(path)))
    for (let i = 0; i < mounts.length; i++) {
      t.same(contents[i], Buffer.from(mounts[i].content))
    }
  }
})

test('can replicate nested mounts between daemons', async t => {
  const { clients, cleanup } = await create(2)
  const firstClient = clients[0]
  const secondClient = clients[1]

  try {
    const firstRoot = await firstClient.drive.get()
    const firstMount1 = await firstClient.drive.get()
    const firstMount2 = await firstClient.drive.get()
    await firstMount2.configureNetwork({ lookup: true, announce: true })

    await firstRoot.mount('a', { key: firstMount1.key })
    await firstMount1.mount('b', { key: firstMount2.key })

    await firstMount2.writeFile('hello', 'world')

    const secondRoot = await secondClient.drive.get()
    await secondClient.drive.get({ key: firstMount2.key })

    await secondRoot.mount('c', { key: firstMount2.key })

    // 100 ms delay for replication.
    await delay(100)

    const replicatedContent = await secondRoot.readFile('c/hello')
    t.same(replicatedContent, Buffer.from('world'))
  } catch (err) {
    t.fail(err)
  }

  await cleanup()
  t.end()
})

test('can get networking stats for multiple mounts', async t => {
  const { clients, cleanup } = await create(2)
  const firstClient = clients[0]
  const secondClient = clients[1]

  try {
    const firstRoot = await firstClient.drive.get()
    const firstMount1 = await firstClient.drive.get()
    const firstMount2 = await firstClient.drive.get()
    await firstMount2.configureNetwork({ lookup: true, announce: true })

    await firstRoot.mount('a', { key: firstMount1.key })
    await firstRoot.mount('b', { key: firstMount2.key })

    await firstMount2.writeFile('hello', 'world')

    const firstStats = await firstClient.drive.allStats()
    t.same(firstStats.length, 3)
    for (const mountStats of firstStats) {
      t.same(mountStats.length, 1)
      t.same(mountStats[0].metadata.uploadedBytes, 0)
    }

    const secondRoot = await secondClient.drive.get()
    await secondClient.drive.get({ key: firstMount2.key })

    await secondRoot.mount('c', { key: firstMount2.key })

    // 100 ms delay for replication.
    await delay(100)

    const replicatedContent = await secondRoot.readFile('c/hello')
    t.same(replicatedContent, Buffer.from('world'))

    const secondStats = await firstClient.drive.allStats()
    t.same(secondStats.length, 3)

    var uploadedBytes = null
    for (const mountStats of secondStats) {
      if (mountStats[0].metadata.key.equals(firstMount2.key)) {
        uploadedBytes = mountStats[0].content.uploadedBytes
        t.notEqual(uploadedBytes, 0)
      }
    }
    t.true(uploadedBytes)

    const { stats: thirdStats } = await firstMount2.stats()
    t.same(thirdStats[0].content.uploadedBytes, uploadedBytes)
  } catch (err) {
    t.fail(err)
  }

  await cleanup()
  t.end()
})

// This will hang until we add timeouts to the hyperdrive reads.
test.skip('can continue getting drive info after remote content is cleared (no longer available)', async t => {
  const { clients, cleanup, daemons } = await create(2)
  const firstClient = clients[0]
  const secondClient = clients[1]

  const localStore = daemons[0].corestore

  try {
    const drive = await firstClient.drive.get()
    await drive.configureNetwork({ announce: true, lookup: true })
    await drive.writeFile('hello', 'world')
    const clone = await secondClient.drive.get({ key: drive.key })
    console.log('DRIVE KEY:', drive.key.toString('hex'))
    console.log('DRIVE DKEY:', hypercoreCrypto.discoveryKey(drive.key).toString('hex'))

    await delay(500)

    t.same(await clone.readFile('hello'), Buffer.from('world'))
    await drive.writeFile('hello', 'brave new world')

    await clearContent([drive.key], localStore)

    const cloneStats = await clone.stats()
    console.log('clone stats here:', cloneStats)
  } catch (err) {
    t.fail(err)
  }


  await cleanup()
  t.end()

  async function clearContent (metadataKeys, store) {
    const metadataKeySet = new Set(metadataKeys.map(k => k.toString('hex')))
    console.log('metadataKeySet:', metadataKeySet)
    console.log('external cores:', store._externalCores)
    for (const [dkeyString, core] of store._externalCores) {
      if (metadataKeySet.has(core.key.toString('hex'))) continue
      await new Promise((resolve, reject) => {
        console.log('CLEARING CORE:', core)
        core.clear(0, core.length, err => {
          if (err) return reject(err)
          return resolve()
        })
      })
    }
  }
})

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
