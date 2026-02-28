// export interface Onebject extends object {
//   _id: string;
// }

/* export const objectId = () => {
  const timestamp = Math.floor(Date.now() / 1000)

  const timeBytes = Buffer.alloc(4)
  timeBytes.writeUInt32BE(timestamp)

  // const randomBytes = crypto.randomBytes(5)
  const randomBytes = crypto.getRandomValues(new Uint8Array(5));

  const counter = Buffer.alloc(3)
  counter.writeUIntBE(Math.floor(Math.random() * 0xffffff), 0, 3)

  return Buffer.concat([timeBytes, randomBytes, counter]).toString("hex")
} */

let counter = Math.floor(Math.random() * 0xffffff)

const machineId = (() => {
  const arr = new Uint8Array(5)
  crypto.getRandomValues(arr)
  return arr
})()

export function objectId(): string {
  const bytes = new Uint8Array(12)

  // timestamp (4 bytes)
  const timestamp = Math.floor(Date.now() / 1000)
  bytes[0] = (timestamp >> 24) & 0xff
  bytes[1] = (timestamp >> 16) & 0xff
  bytes[2] = (timestamp >> 8) & 0xff
  bytes[3] = timestamp & 0xff

  // machine id (5 bytes)
  bytes.set(machineId, 4)

  // counter (3 bytes)
  counter = (counter + 1) % 0xffffff

  bytes[9] = (counter >> 16) & 0xff
  bytes[10] = (counter >> 8) & 0xff
  bytes[11] = counter & 0xff

  // converter para hex
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
}

export const objectIdRegex = /^[a-f0-9]{24}$/;