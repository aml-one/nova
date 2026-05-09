import "dart:async";
import "dart:io";
import "dart:math" as math;

import "package:flutter/material.dart";
import "package:flutter/services.dart";
import "package:path_provider/path_provider.dart";
import "package:permission_handler/permission_handler.dart";
import "package:record/record.dart";

import "../audio/nova_audio_player.dart";
import "../nova_api.dart";
import "../theme/nova_theme.dart";
import "../widgets/nova_voice_orb.dart";
import "webrtc_call_page.dart";

/// Walkie (PTT) plus optional WebRTC duplex via the Python gateway.
class VoiceSessionPage extends StatefulWidget {
  const VoiceSessionPage({super.key, required this.api});

  final NovaApi api;

  @override
  State<VoiceSessionPage> createState() => _VoiceSessionPageState();
}

class _VoiceSessionPageState extends State<VoiceSessionPage> {
  final AudioRecorder _recorder = AudioRecorder();
  final NovaAudioPlayer _player = NovaAudioPlayer();
  final NovaVoiceOrbController _orb = NovaVoiceOrbController();
  StreamSubscription<Amplitude>? _ampSub;
  Timer? _playOrbTimer;
  bool _recording = false;
  bool _busy = false;
  String _status = "Hold the button to speak, release to send to Nova.";
  String _lastReply = "";

  @override
  void dispose() {
    _ampSub?.cancel();
    _playOrbTimer?.cancel();
    _orb.dispose();
    unawaited(_player.stop());
    unawaited(() async {
      if (await _recorder.isRecording()) {
        await _recorder.stop();
      }
      await _recorder.dispose();
    }());
    super.dispose();
  }

  double _dbToLevel(double db) => ((db + 55) / 55).clamp(0.0, 1.0);

  void _pulseOrbForPlayback() {
    _playOrbTimer?.cancel();
    var t = 0.0;
    _playOrbTimer = Timer.periodic(const Duration(milliseconds: 55), (_) {
      t += 0.2;
      final s = 0.38 + 0.48 * (0.5 + 0.5 * math.sin(t));
      _orb.setSpeechEnvelope(s, (s + 0.2).clamp(0.0, 1.0));
    });
  }

  Future<bool> _ensureMic() async {
    final st = await Permission.microphone.request();
    return st.isGranted;
  }

  Future<void> _playReplyTts(String text) async {
    if (text.trim().isEmpty) {
      return;
    }
    try {
      _pulseOrbForPlayback();
      final audio = await widget.api.speakAudio(text);
      await _player.playSpeakResult(audio);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text("TTS failed: $e")));
      }
    } finally {
      _playOrbTimer?.cancel();
      _orb.applyPreset(NovaVoiceOrbPreset.speaking);
    }
  }

  Future<void> _simulateIncomingCall() async {
    if (_busy) {
      return;
    }
    setState(() {
      _busy = true;
      _status = "Incoming…";
    });
    for (var i = 0; i < 3; i++) {
      HapticFeedback.heavyImpact();
      await Future<void>.delayed(const Duration(milliseconds: 420));
    }
    try {
      final greeting = await widget.api.chat(
        "The user just answered a simulated voice call in the mobile app. "
        "Reply with one short friendly spoken-style sentence (no markdown, no bullet list).",
      );
      setState(() {
        _lastReply = greeting;
        _status = "Nova is speaking…";
      });
      await _playReplyTts(greeting);
      setState(() => _status = "Connected — hold to talk to Nova.");
    } catch (e) {
      setState(() => _status = "Could not complete incoming demo: $e");
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _onPushTalk(bool pressed) async {
    if (_busy) {
      return;
    }
    if (pressed) {
      final ok = await _ensureMic();
      if (!ok) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Microphone permission denied.")));
        }
        return;
      }
      final dir = await getTemporaryDirectory();
      final ext = Platform.isWindows ? "wav" : "m4a";
      final path = "${dir.path}/nova_ptt_${DateTime.now().microsecondsSinceEpoch}.$ext";
      await _recorder.start(
        RecordConfig(
          encoder: Platform.isWindows ? AudioEncoder.wav : AudioEncoder.aacLc,
          sampleRate: 44100,
        ),
        path: path,
      );
      await _ampSub?.cancel();
      _ampSub = _recorder.onAmplitudeChanged(const Duration(milliseconds: 90)).listen((amp) {
        final smooth = _dbToLevel(amp.current);
        final peak = _dbToLevel(amp.max);
        _orb.setSpeechEnvelope(smooth, math.max(peak, smooth));
      });
      setState(() {
        _recording = true;
        _status = "Listening…";
      });
      return;
    }
    if (!_recording) {
      return;
    }
    await _ampSub?.cancel();
    _ampSub = null;
    setState(() {
      _recording = false;
      _busy = true;
      _status = "Transcribing…";
    });
    _orb.applyPreset(NovaVoiceOrbPreset.thinking);
    try {
      final path = await _recorder.stop();
      if (path == null || path.isEmpty) {
        throw Exception("no recording");
      }
      final bytes = await File(path).readAsBytes();
      final mime = Platform.isWindows ? "audio/wav" : "audio/mp4";
      final text = await widget.api.transcribeAudioBytes(bytes, mimeType: mime);
      if (text.trim().isEmpty) {
        setState(() => _status = "No speech detected — try again.");
        _orb.applyPreset(NovaVoiceOrbPreset.speaking);
        return;
      }
      setState(() => _status = "Nova is thinking…");
      final reply = await widget.api.chat(text.trim());
      setState(() {
        _lastReply = reply;
        _status = "Playing Nova's reply…";
      });
      _orb.applyPreset(NovaVoiceOrbPreset.speaking);
      await _playReplyTts(reply);
      setState(() => _status = "Hold to speak again.");
    } catch (e) {
      setState(() => _status = "Error: $e");
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: NovaTheme.canvas,
      appBar: AppBar(
        title: const Text("Voice"),
        actions: [
          TextButton(
            onPressed: _busy ? null : _simulateIncomingCall,
            child: const Text("Demo ring"),
          ),
          IconButton(
            tooltip: "WebRTC call",
            onPressed: () {
              Navigator.of(context).push<void>(
                MaterialPageRoute<void>(builder: (_) => WebrtcCallPage(api: widget.api)),
              );
            },
            icon: const Icon(Icons.call_rounded),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            const SizedBox(height: 8),
            DecoratedBox(
              decoration: BoxDecoration(shape: BoxShape.circle, boxShadow: NovaTheme.softGlow(NovaTheme.accent)),
              child: NovaVoiceOrb(controller: _orb, size: 220, preset: NovaVoiceOrbPreset.speaking, baseColor: NovaTheme.accent),
            ),
            const SizedBox(height: 22),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 22),
              child: Text(
                _status,
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.white.withValues(alpha: 0.78), height: 1.4, fontSize: 14),
              ),
            ),
            if (_lastReply.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: NovaTheme.surface2.withValues(alpha: 0.85),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: Colors.white.withValues(alpha: 0.06)),
                  ),
                  child: Text(_lastReply, style: TextStyle(color: Colors.white.withValues(alpha: 0.88), height: 1.35)),
                ),
              ),
            const Spacer(),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 28),
              child: Column(
                children: [
                  Text(
                    "Push to talk — release to send",
                    style: TextStyle(color: Colors.white.withValues(alpha: 0.45), fontSize: 12),
                  ),
                  const SizedBox(height: 16),
                  Listener(
                    onPointerDown: (_) => unawaited(_onPushTalk(true)),
                    onPointerUp: (_) => unawaited(_onPushTalk(false)),
                    onPointerCancel: (_) => unawaited(_onPushTalk(false)),
                    child: Material(
                      color: _recording ? Colors.redAccent.shade200 : NovaTheme.accent,
                      shape: const CircleBorder(),
                      elevation: 8,
                      shadowColor: NovaTheme.accent.withValues(alpha: 0.45),
                      child: const SizedBox(
                        width: 92,
                        height: 92,
                        child: Icon(Icons.mic_rounded, size: 46, color: Colors.white),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
