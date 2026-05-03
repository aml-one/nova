import { Buffer } from "node:buffer";

/** Prepends PCM silence to WAV `data` chunk (PCM format 1). Non‑WAV or exotic layouts returned unchanged. */
export function prependSilenceToWavPcm(buf: Buffer, silenceMs: number): Buffer {
  if (silenceMs <= 0 || buf.length < 44) return buf;
  if (buf.subarray(0, 4).toString("ascii") !== "RIFF" || buf.subarray(8, 12).toString("ascii") !== "WAVE") {
    return buf;
  }

  let pos = 12;
  let fmtBody: Buffer | undefined;
  let dataChunkHeaderStart = -1;
  let dataOffset = -1;
  let dataSize = 0;

  while (pos + 8 <= buf.length) {
    const id = buf.subarray(pos, pos + 4).toString("ascii");
    const sz = buf.readUInt32LE(pos + 4);
    const bodyStart = pos + 8;
    if (bodyStart + sz > buf.length) return buf;
    const padded = sz + (sz % 2);

    if (id === "fmt ") {
      fmtBody = buf.subarray(bodyStart, bodyStart + sz);
    } else if (id === "data") {
      dataChunkHeaderStart = pos;
      dataOffset = bodyStart;
      dataSize = sz;
      break;
    }
    pos = bodyStart + padded;
  }

  if (!fmtBody || fmtBody.length < 16 || dataChunkHeaderStart < 0 || dataOffset < 0 || dataSize < 0) {
    return buf;
  }

  const audioFormat = fmtBody.readUInt16LE(0);
  if (audioFormat !== 1) return buf;

  const numChannels = fmtBody.readUInt16LE(2);
  const sampleRate = fmtBody.readUInt32LE(4);
  const bitsPerSample = fmtBody.readUInt16LE(14);
  if (bitsPerSample !== 16 || numChannels < 1 || sampleRate < 8000) return buf;

  const bytesPerFrame = numChannels * (bitsPerSample / 8);
  const silentFrames = Math.floor((sampleRate * silenceMs) / 1000);
  const silentBytes = silentFrames * bytesPerFrame;
  if (silentBytes <= 0) return buf;

  const pcmOld = buf.subarray(dataOffset, dataOffset + dataSize);
  const pcmNew = Buffer.concat([Buffer.alloc(silentBytes, 0), pcmOld]);
  const newDataSize = pcmNew.length;

  const head = buf.subarray(0, dataChunkHeaderStart);
  const dataHdr = Buffer.alloc(8);
  dataHdr.write("data", 0, 4, "ascii");
  dataHdr.writeUInt32LE(newDataSize, 4);

  const out = Buffer.concat([head, dataHdr, pcmNew]);
  out.writeUInt32LE(out.length - 8, 4);
  return out;
}
