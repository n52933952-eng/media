import fs from 'fs'

function readGlbJson(file) {
  const buf = fs.readFileSync(file)
  let off = 12
  while (off < buf.length) {
    const len = buf.readUInt32LE(off)
    const type = buf.readUInt32LE(off + 4)
    if (type === 0x4e4f534a) return JSON.parse(buf.subarray(off + 8, off + 8 + len).toString('utf8'))
    off += 8 + len + ((4 - (len % 4)) % 4)
  }
}

const WHEEL_X_OFFSET = 0.8
const WHEEL_Z_OFFSET = 1.5
const WHEEL_RADIUS = 0.4
const SUSPENSION_REST_LENGTH = 0.3
const BODY_GROUND_GAP = 0.09

for (const file of process.argv.slice(2)) {
  const g = readGlbJson(file)
  const nodeBox = (i) => {
    const n = g.nodes[i]
    const t = n.translation || [0, 0, 0]
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (const p of g.meshes[n.mesh].primitives) {
      const a = g.accessors[p.attributes.POSITION]
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], a.min[k] + t[k])
        max[k] = Math.max(max[k], a.max[k] + t[k])
      }
    }
    return { name: n.name, min, max }
  }

  const meshNodes = g.nodes.map((n, i) => i).filter((i) => g.nodes[i].mesh != null)
  const wheels = meshNodes.filter((i) => /wheel/i.test(g.nodes[i].name || '')).map(nodeBox)
  const body = meshNodes.filter((i) => !/wheel/i.test(g.nodes[i].name || '')).map(nodeBox)[0]

  const halfTrack = Math.max(...wheels.map((w) => Math.abs((w.min[0] + w.max[0]) / 2)))
  const scale = WHEEL_X_OFFSET / halfTrack

  const wholeMinY = Math.min(body.min[1], ...wheels.map((w) => w.min[1])) * scale
  const lift = -(WHEEL_RADIUS + SUSPENSION_REST_LENGTH - BODY_GROUND_GAP) - wholeMinY

  const road = -(WHEEL_RADIUS + SUSPENSION_REST_LENGTH)
  console.log('\n=== ' + file.split(/[\\/]/).pop() + ' ===')
  console.log('scale', scale.toFixed(3), ' lift', lift.toFixed(3), ' (road is y =', road, 'under the car origin)')
  console.log('body alone      y:', (body.min[1] * scale + lift).toFixed(3), '..', (body.max[1] * scale + lift).toFixed(3))
  console.log('body alone      x:', (body.min[0] * scale).toFixed(2), '..', (body.max[0] * scale).toFixed(2))
  for (const w of wheels) {
    const cx = ((w.min[0] + w.max[0]) / 2) * scale
    const cy = ((w.min[1] + w.max[1]) / 2) * scale + lift
    const cz = ((w.min[2] + w.max[2]) / 2) * scale
    const r = Math.max(w.max[1] - w.min[1], w.max[2] - w.min[2]) / 2 * scale
    console.log('  ' + w.name.padEnd(34), 'model slot x', cx.toFixed(2), 'y', cy.toFixed(2), 'z', cz.toFixed(2), '| radius', r.toFixed(2))
  }
  console.log('physics puts wheels at x ±' + WHEEL_X_OFFSET, 'z ±' + WHEEL_Z_OFFSET, 'y', (-SUSPENSION_REST_LENGTH).toFixed(2), '| radius', WHEEL_RADIUS)
  console.log('body bottom sits', (body.min[1] * scale + lift - road).toFixed(3), 'm above the road')
}
