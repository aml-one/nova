"""
Nova voice WebRTC gateway

- WebSocket signaling at /ws/voice (JSON: auth, offer, answer, ice).
- One RTCPeerConnection per socket; exchanges SDP/ICE with Flutter (flutter_webrtc).
- Duplex audio: inbound Opus → PCM → WAV → POST /v1/voice/transcribe-audio (base64);
  reply text → POST /v1/chat → POST /v1/voice/speak-audio → decode → PCM frames to client.

Env:
  NOVA_AGENT_BASE   — agent-core URL (default http://127.0.0.1:8787)
  NOVA_VOICE_HOST   — bind host (default 0.0.0.0)
  NOVA_VOICE_PORT   — bind port (default 8790)
  NOVA_ICE_SERVERS  — optional JSON array, e.g.
    [{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]

For production behind NAT, configure TURN (e.g. coturn) and list it in NOVA_ICE_SERVERS.
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import os
import time
import wave
from typing import Any

import av
import httpx
import numpy as np
from aiortc import (
    RTCConfiguration,
    RTCIceCandidate,
    RTCIceServer,
    RTCPeerConnection,
    RTCSessionDescription,
)
from aiortc.mediastreams import MediaStreamError, MediaStreamTrack
from av.audio import AudioFrame
from av.audio.resampler import AudioResampler
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("nova-voice-gateway")

NOVA_BASE = os.environ.get("NOVA_AGENT_BASE", "http://127.0.0.1:8787").rstrip("/")

SAMPLE_RATE_OUT = 48000
SAMPLES_PER_FRAME = 960  # 20 ms @ 48 kHz
STT_RATE = 16000


def ice_configuration_from_env() -> RTCConfiguration:
    raw = os.environ.get("NOVA_ICE_SERVERS", "").strip()
    servers: list[RTCIceServer] = []
    if raw:
        try:
            for item in json.loads(raw):
                urls = item.get("urls") or item.get("url")
                if isinstance(urls, str):
                    ulist = [urls]
                elif isinstance(urls, list):
                    ulist = [str(u) for u in urls]
                else:
                    continue
                username = item.get("username")
                credential = item.get("credential")
                servers.append(
                    RTCIceServer(
                        urls=ulist,
                        username=username,
                        credential=credential,
                    )
                )
        except json.JSONDecodeError:
            log.warning("NOVA_ICE_SERVERS is not valid JSON; falling back to public STUN")
    if not servers:
        servers.append(RTCIceServer(urls=["stun:stun.l.google.com:19302"]))
    return RTCConfiguration(iceServers=servers)


def ice_servers_public_dict() -> list[dict[str, Any]]:
    """Shape expected by flutter_webrtc (urls + optional username/credential)."""
    cfg = ice_configuration_from_env()
    out: list[dict[str, Any]] = []
    for s in cfg.iceServers or []:
        entry: dict[str, Any] = {"urls": s.urls}
        if s.username:
            entry["username"] = s.username
        if s.credential:
            entry["credential"] = s.credential
        out.append(entry)
    return out


class NovaHttp:
    def __init__(self, base: str, session_token: str) -> None:
        self.base = base
        self.headers = {"x-session-token": session_token}

    async def auth_me(self, client: httpx.AsyncClient) -> bool:
        r = await client.get(f"{self.base}/v1/auth/me", headers=self.headers, timeout=15.0)
        return r.status_code == 200

    async def transcribe_wav(self, client: httpx.AsyncClient, wav_bytes: bytes) -> str:
        payload = {
            "audioBase64": base64.b64encode(wav_bytes).decode("ascii"),
            "mimeType": "audio/wav",
        }
        r = await client.post(
            f"{self.base}/v1/voice/transcribe-audio",
            json=payload,
            headers=self.headers,
            timeout=120.0,
        )
        r.raise_for_status()
        data = r.json()
        return str(data.get("text") or "").strip()

    async def chat(self, client: httpx.AsyncClient, message: str) -> str:
        r = await client.post(
            f"{self.base}/v1/chat",
            json={"message": message},
            headers=self.headers,
            timeout=300.0,
        )
        r.raise_for_status()
        data = r.json()
        return str(data.get("reply") or "").strip()

    async def speak_audio(self, client: httpx.AsyncClient, text: str) -> tuple[bytes, str]:
        r = await client.post(
            f"{self.base}/v1/voice/speak-audio",
            json={"text": text},
            headers=self.headers,
            timeout=300.0,
        )
        r.raise_for_status()
        mime = r.headers.get("content-type", "audio/wav")
        return r.content, mime


def pcm_s16le_to_wav(pcm: bytes, sample_rate: int, channels: int = 1) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm)
    return buf.getvalue()


def silent_frame() -> AudioFrame:
    frame = AudioFrame(format="s16", layout="mono", samples=SAMPLES_PER_FRAME)
    z = np.zeros(SAMPLES_PER_FRAME, dtype=np.int16).tobytes()
    frame.planes[0].update(z)
    frame.sample_rate = SAMPLE_RATE_OUT
    frame.time_base = 1 / SAMPLE_RATE_OUT
    return frame


class NovaOutboundAudioTrack(MediaStreamTrack):
    """Outbound audio to the client (48 kHz mono s16), fed from a FIFO."""

    kind = "audio"

    def __init__(self) -> None:
        super().__init__()
        self._queue: asyncio.Queue[AudioFrame] = asyncio.Queue(maxsize=512)
        self._timestamp = 0

    async def recv(self) -> AudioFrame:
        try:
            frame = await asyncio.wait_for(self._queue.get(), timeout=0.05)
        except asyncio.TimeoutError:
            frame = silent_frame()
        frame.pts = self._timestamp
        frame.time_base = 1 / SAMPLE_RATE_OUT
        self._timestamp += SAMPLES_PER_FRAME
        return frame

    async def enqueue_frames(self, frames: list[AudioFrame]) -> None:
        for fr in frames:
            await self._queue.put(fr)


def decode_tts_to_frames(audio_bytes: bytes, mime: str) -> list[AudioFrame]:
    """Decode TTS bytes to 48 kHz mono s16 frames (20 ms)."""
    resampler = AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE_OUT)
    out_frames: list[AudioFrame] = []
    f = io.BytesIO(audio_bytes)
    try:
        container = av.open(f, mode="r", format=None if mime.endswith("wav") else None)
    except av.AVError:
        container = av.open(f, mode="r")
    try:
        stream = next((s for s in container.streams if s.type == "audio"), None)
        if stream is None:
            return []
        for packet in container.demux(stream):
            for af in packet.decode():
                if not isinstance(af, AudioFrame):
                    continue
                af.pts = None
                for rfr in resampler.resample(af):
                    arr = rfr.to_ndarray()
                    if arr.ndim == 2:
                        arr = arr.mean(axis=0)
                    pcm = np.clip(arr, -32768, 32767).astype(np.int16)
                    # chunk into SAMPLES_PER_FRAME
                    flat = pcm.tobytes()
                    bps = 2
                    spf = SAMPLES_PER_FRAME
                    for i in range(0, len(flat), spf * bps):
                        chunk = flat[i : i + spf * bps]
                        if len(chunk) < spf * bps:
                            chunk = chunk + b"\x00" * (spf * bps - len(chunk))
                        nf = AudioFrame(format="s16", layout="mono", samples=spf)
                        nf.planes[0].update(chunk)
                        nf.sample_rate = SAMPLE_RATE_OUT
                        out_frames.append(nf)
    finally:
        container.close()
    return out_frames


async def consume_mic(
    track,
    nova: NovaHttp,
    out_track: NovaOutboundAudioTrack,
    http: httpx.AsyncClient,
) -> None:
    resampler = AudioResampler(format="s16", layout="mono", rate=STT_RATE)
    pcm_buf = bytearray()
    last_sound = time.monotonic()
    min_bytes = STT_RATE * 2 * 1  # 1 second minimum before flush on silence
    max_bytes = STT_RATE * 2 * 4  # cap ~4 s

    rms_threshold = 420.0

    while True:
        try:
            frame = await track.recv()
        except MediaStreamError:
            break
        except Exception:
            break
        if not isinstance(frame, AudioFrame):
            continue
        try:
            rfr = resampler.resample(frame)[0]
            arr = rfr.to_ndarray()
            if arr.ndim == 2:
                arr = arr.mean(axis=0)
            pcm = np.clip(arr, -32768, 32767).astype(np.int16).tobytes()
        except Exception:
            continue
        pcm_buf.extend(pcm)
        try:
            s = np.frombuffer(pcm, dtype=np.int16)
            rms = float(np.sqrt(np.mean(s.astype(np.float64) ** 2)))
        except Exception:
            rms = 0
        if rms > rms_threshold:
            last_sound = time.monotonic()

        now = time.monotonic()
        silence = now - last_sound > 0.45
        if len(pcm_buf) >= max_bytes or (silence and len(pcm_buf) >= min_bytes):
            wav_b = pcm_s16le_to_wav(bytes(pcm_buf), STT_RATE, 1)
            pcm_buf.clear()
            last_sound = now
            try:
                text = await nova.transcribe_wav(http, wav_b)
            except Exception as exc:
                log.warning("transcribe failed: %s", exc)
                continue
            if not text:
                continue
            log.info("stt: %s", text[:120])
            try:
                reply = await nova.chat(http, text)
            except Exception as exc:
                log.warning("chat failed: %s", exc)
                continue
            if not reply:
                continue
            log.info("reply len=%s", len(reply))
            try:
                raw, mime = await nova.speak_audio(http, reply)
            except Exception as exc:
                log.warning("tts failed: %s", exc)
                continue
            frames = decode_tts_to_frames(raw, mime)
            if frames:
                await out_track.enqueue_frames(frames)


app = FastAPI(title="Nova voice WebRTC gateway")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"ok": "true", "service": "nova-voice-webrtc-gateway"}


@app.get("/v1/ice")
async def ice_config() -> JSONResponse:
    return JSONResponse({"iceServers": ice_servers_public_dict()})


@app.websocket("/ws/voice")
async def voice_ws(ws: WebSocket) -> None:
    await ws.accept()
    nova: NovaHttp | None = None
    pc: RTCPeerConnection | None = None
    out_audio: NovaOutboundAudioTrack | None = None
    mic_task: asyncio.Task | None = None
    http_client = httpx.AsyncClient()

    async def send_json(obj: dict[str, Any]) -> None:
        await ws.send_text(json.dumps(obj))

    try:
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            mtype = msg.get("type")

            if mtype == "auth":
                token = str(msg.get("token") or "").strip()
                if not token:
                    await send_json({"type": "error", "message": "missing token"})
                    continue
                nova = NovaHttp(NOVA_BASE, token)
                if not await nova.auth_me(http_client):
                    await send_json({"type": "error", "message": "auth failed"})
                    continue
                await send_json({"type": "auth_ok", "iceServers": ice_servers_public_dict()})
                continue

            if mtype == "offer":
                if nova is None:
                    await send_json({"type": "error", "message": "auth first"})
                    continue
                sdp = str(msg.get("sdp") or "")
                if not sdp:
                    await send_json({"type": "error", "message": "empty sdp"})
                    continue
                if pc is not None:
                    await pc.close()
                cfg = ice_configuration_from_env()
                pc = RTCPeerConnection(configuration=cfg)
                out_audio = NovaOutboundAudioTrack()

                @pc.on("icecandidate")
                async def on_ice(candidate: RTCIceCandidate | None) -> None:  # type: ignore[misc]
                    if candidate is None:
                        await send_json({"type": "ice", "candidate": None})
                        return
                    cand_sdp = getattr(candidate, "candidate", None) or str(candidate)
                    await send_json(
                        {
                            "type": "ice",
                            "candidate": {
                                "candidate": cand_sdp,
                                "sdpMid": candidate.sdpMid,
                                "sdpMLineIndex": candidate.sdpMLineIndex,
                            },
                        }
                    )

                @pc.on("track")
                def on_track(track) -> None:  # type: ignore[no-untyped-def]
                    if track.kind != "audio":
                        return
                    log.info("remote audio track")
                    nonlocal mic_task
                    if mic_task:
                        mic_task.cancel()

                    async def run() -> None:
                        await consume_mic(track, nova, out_audio, http_client)

                    mic_task = asyncio.create_task(run())

                await pc.setRemoteDescription(RTCSessionDescription(sdp=sdp, type="offer"))
                pc.addTrack(out_audio)
                answer = await pc.createAnswer()
                await pc.setLocalDescription(answer)
                await send_json({"type": "answer", "sdp": pc.localDescription.sdp})
                continue

            if mtype == "ice":
                if pc is None:
                    continue
                c = msg.get("candidate")
                if c is None:
                    continue
                if isinstance(c, dict) and c.get("candidate"):
                    try:
                        cand = RTCIceCandidate(
                            sdpMid=c.get("sdpMid"),
                            sdpMLineIndex=c.get("sdpMLineIndex"),
                            candidate=c.get("candidate"),
                        )
                        await pc.addIceCandidate(cand)
                    except Exception as exc:
                        log.debug("addIceCandidate: %s", exc)
                continue

            await send_json({"type": "error", "message": f"unknown type {mtype}"})
    except WebSocketDisconnect:
        pass
    finally:
        if mic_task:
            mic_task.cancel()
        if pc:
            await pc.close()
        await http_client.aclose()


def main() -> None:
    host = os.environ.get("NOVA_VOICE_HOST", "0.0.0.0")
    port = int(os.environ.get("NOVA_VOICE_PORT", "8790"))
    log.info("Nova agent at %s — gateway on %s:%s", NOVA_BASE, host, port)
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
