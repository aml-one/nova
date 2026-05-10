import "dart:async";
import "dart:io";
import "dart:math" as math;
import "dart:typed_data";

import "package:audioplayers/audioplayers.dart";
import "package:path_provider/path_provider.dart";

import "../nova_api.dart";
import "../widgets/nova_voice_orb.dart";

/// PCM16 WAV → RMS per [hopMs], normalized ~0…1 for TTS orb driving (WebUI-style).
List<double>? tryParseWavRmsEnvelope(Uint8List bytes, {int hopMs = 20}) {
  if (bytes.length < 44) {
    return null;
  }
  if (String.fromCharCodes(bytes.sublist(0, 4)) != "RIFF" || String.fromCharCodes(bytes.sublist(8, 12)) != "WAVE") {
    return null;
  }
  var off = 12;
  int? audioFormat;
  int? numChannels;
  int? sampleRate;
  int? bitsPerSample;
  Uint8List? pcm;
  while (off + 8 <= bytes.length) {
    final id = String.fromCharCodes(bytes.sublist(off, off + 4));
    final size = bytes.buffer.asByteData().getUint32(off + 4, Endian.little);
    off += 8;
    if (off + size > bytes.length) {
      break;
    }
    if (id == "fmt " && size >= 16) {
      final bd = ByteData.sublistView(bytes, off, off + size);
      audioFormat = bd.getUint16(0, Endian.little);
      numChannels = bd.getUint16(2, Endian.little);
      sampleRate = bd.getUint32(4, Endian.little);
      bitsPerSample = bd.getUint16(14, Endian.little);
    } else if (id == "data") {
      pcm = bytes.sublist(off, off + size);
    }
    off += size + (size & 1);
  }
  if (audioFormat != 1 || bitsPerSample != 16 || pcm == null || pcm.isEmpty || numChannels == null || sampleRate == null) {
    return null;
  }
  final frameBytes = numChannels * 2;
  final sampleFrames = pcm.length ~/ frameBytes;
  if (sampleFrames <= 0) {
    return null;
  }
  final hopSamples = math.max(1, (sampleRate * hopMs / 1000).round());
  final pcmBd = ByteData.sublistView(pcm);
  final out = <double>[];
  for (var start = 0; start < sampleFrames; start += hopSamples) {
    final end = math.min(start + hopSamples, sampleFrames);
    var sum = 0.0;
    var count = 0;
    for (var f = start; f < end; f++) {
      var acc = 0;
      for (var ch = 0; ch < numChannels; ch++) {
        final o = (f * numChannels + ch) * 2;
        acc += pcmBd.getInt16(o, Endian.little);
      }
      final mono = acc / numChannels;
      sum += mono * mono;
      count++;
    }
    final rms = math.sqrt(sum / math.max(1, count));
    out.add((rms / 12000).clamp(0.0, 1.0));
  }
  return out.isEmpty ? null : out;
}

/// Fallback when TTS is not PCM WAV — syllable-ish energy curve.
List<double> buildSyntheticTtsEnvelope(int totalMs, math.Random rng, {int hopMs = 20}) {
  final n = math.max(16, totalMs ~/ hopMs);
  final out = List<double>.filled(n, 0.05);
  var i = 0;
  while (i < n - 8) {
    final grain = 22 + rng.nextInt(55);
    final peak = 0.32 + rng.nextDouble() * 0.68;
    for (var j = 0; j < grain && i + j < n; j++) {
      final u = j / math.max(1, grain - 1);
      final w = math.sin(u * math.pi);
      out[i + j] = (0.08 + peak * w * w).clamp(0.0, 1.0);
    }
    i += grain;
    i += 5 + rng.nextInt(28);
  }
  return out;
}

/// Plays TTS bytes from `/v1/voice/speak-audio` (same as WebUI read-aloud).
class NovaAudioPlayer {
  NovaAudioPlayer() {
    _player.onPlayerComplete.listen((_) {
      _playing = false;
      _ttsOrbDriver?.finish();
      _ttsOrbDriver = null;
    });
  }

  final AudioPlayer _player = AudioPlayer();
  _TtsOrbDriver? _ttsOrbDriver;
  bool _playing = false;

  bool get isPlaying => _playing;

  Future<void> stop() async {
    _ttsOrbDriver?.finish();
    _ttsOrbDriver = null;
    await _player.stop();
    _playing = false;
  }

  /// [orb]: when set, drives the orb from WAV RMS (or synthetic) using the same
  /// attack / word-spike / direction cues as WebUI `page.tsx` TTS analyser loop.
  Future<void> playSpeakResult(
    SpeakAudioResult result, {
    NovaVoiceOrbController? orb,
  }) async {
    await stop();
    final dir = await getTemporaryDirectory();
    var ext = "wav";
    final m = result.mimeType.toLowerCase();
    final looksCompressed = m.contains("mpeg") || m.contains("mp3") || m.contains("ogg") || m.contains("opus");
    if (looksCompressed) {
      if (m.contains("mpeg") || m.contains("mp3")) {
        ext = "mp3";
      } else {
        ext = "opus";
      }
    }
    final file = File("${dir.path}/nova_tts_${DateTime.now().microsecondsSinceEpoch}.$ext");
    await file.writeAsBytes(result.bytes, flush: true);
    _playing = true;

    const hopMs = 20;
    final rng = math.Random();
    List<double> envelope = tryParseWavRmsEnvelope(result.bytes, hopMs: hopMs) ??
        buildSyntheticTtsEnvelope(math.min(120000, math.max(2800, result.bytes.length ~/ 600)), rng, hopMs: hopMs);

    await _player.play(DeviceFileSource(file.path));

    if (looksCompressed) {
      await Future<void>.delayed(const Duration(milliseconds: 160));
      final d = await _player.getDuration();
      if (d != null && d.inMilliseconds > 600) {
        envelope = buildSyntheticTtsEnvelope(d.inMilliseconds, rng, hopMs: hopMs);
      }
    }

    if (orb != null) {
      _ttsOrbDriver = _TtsOrbDriver(
        orb: orb,
        player: _player,
        envelope: envelope,
        hopMs: hopMs,
      )..start();
    }
  }

  Stream<Duration> get onPosition => _player.onPositionChanged;
  Stream<PlayerState> get onState => _player.onPlayerStateChanged;
}

/// Mirrors WebUI chat TTS orb driver (`page.tsx` analyser tick).
class _TtsOrbDriver {
  _TtsOrbDriver({
    required NovaVoiceOrbController orb,
    required AudioPlayer player,
    required List<double> envelope,
    required this.hopMs,
  })  : _orb = orb,
        _player = player,
        _envelope = envelope;

  final NovaVoiceOrbController _orb;
  final AudioPlayer _player;
  final List<double> _envelope;
  final int hopMs;

  final math.Random _rng = math.Random();
  bool _finished = false;
  Timer? _timer;
  double _voiceLevel = 0;
  double _prevInstant = 0;
  double _wordSpike = 0;
  int _lastFlipMs = 0;
  int _lastTickMs = 0;
  int _nextBackgroundDirMs = 0;

  void start() {
    _lastTickMs = DateTime.now().millisecondsSinceEpoch;
    _nextBackgroundDirMs = _lastTickMs + 10000 + _rng.nextInt(8000);
    _timer = Timer.periodic(const Duration(milliseconds: 45), (_) => unawaited(_tick()));
  }

  Future<void> _tick() async {
    if (_envelope.isEmpty) {
      return;
    }
    final pos = await _player.getCurrentPosition();
    if (pos == null) {
      return;
    }
    final n = _envelope.length;
    final idx = (pos.inMilliseconds ~/ hopMs).clamp(0, n - 1);
    final rmsLike = _envelope[idx];
    // Single-band energy (WAV RMS); thresholds aligned with WebUI time-domain gate.
    final combined = math.min(1.0, rmsLike * 4.5);
    final gated = math.max(0.0, combined - 0.008);

    if (gated > _voiceLevel) {
      _voiceLevel += (gated - _voiceLevel) * 0.94;
    } else {
      _voiceLevel += (gated - _voiceLevel) * 0.085;
    }

    final rise = combined - _prevInstant;
    _prevInstant = combined;

    final nowMs = DateTime.now().millisecondsSinceEpoch;
    final dtMs = _lastTickMs == 0 ? 16.0 : (nowMs - _lastTickMs).clamp(1, 200).toDouble();
    _lastTickMs = nowMs;
    _wordSpike *= math.pow(0.58, dtMs / 16.67).toDouble();

    final onset = combined > 0.065 && rise > 0.028;
    if (onset) {
      final burst = math.min(1.0, combined * 1.35 + rise * 2.45 + 0.14);
      _wordSpike = math.max(_wordSpike, burst);
      if (nowMs - _lastFlipMs > 72) {
        _lastFlipMs = nowMs;
        _orb.randomizeDirection();
        _orb.setRotationSpeed(0.52 + _rng.nextDouble() * 2.85);
      }
    }

    if (gated > 0.04 && nowMs >= _nextBackgroundDirMs) {
      _orb.randomizeDirection();
      _orb.setRotationSpeed(0.45 + _rng.nextDouble() * 1.6);
      _nextBackgroundDirMs = nowMs + 10000 + _rng.nextInt(8000);
    }

    final peakDrive = math.min(1.0, combined * 0.98 + _wordSpike * 1.08);
    _orb.setSpeechEnvelope(_voiceLevel, peakDrive);
  }

  void finish() {
    if (_finished) {
      return;
    }
    _finished = true;
    _timer?.cancel();
    _timer = null;
    _orb.setSpeechEnvelope(0, 0);
    _orb.applyPreset(NovaVoiceOrbPreset.calm);
  }
}
