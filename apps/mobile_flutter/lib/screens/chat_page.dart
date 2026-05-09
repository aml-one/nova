import "dart:async";
import "dart:io";
import "dart:math" as math;

import "package:flutter/material.dart";
import "package:path_provider/path_provider.dart";
import "package:permission_handler/permission_handler.dart";
import "package:record/record.dart";

import "../audio/nova_audio_player.dart";
import "../nova_api.dart";
import "../theme/nova_theme.dart";
import "../widgets/nova_voice_orb.dart";
import "voice_session_page.dart";
import "webrtc_call_page.dart";

class _ChatLine {
  _ChatLine({required this.id, required this.isUser, required this.text, this.voiceTranscript});
  final String id;
  final bool isUser;
  final String text;
  final String? voiceTranscript;
}

class ChatPage extends StatefulWidget {
  const ChatPage({super.key, required this.api});

  final NovaApi api;

  @override
  State<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends State<ChatPage> {
  final TextEditingController _input = TextEditingController();
  final ScrollController _scroll = ScrollController();
  final List<_ChatLine> _lines = [];
  final AudioRecorder _recorder = AudioRecorder();
  final NovaAudioPlayer _tts = NovaAudioPlayer();
  final NovaVoiceOrbController _orb = NovaVoiceOrbController();
  StreamSubscription<Amplitude>? _ampSub;
  Timer? _ttsOrbTimer;
  bool _streaming = false;
  bool _recording = false;
  bool _autoplayNova = true;
  String? _pendingAssistantId;

  @override
  void dispose() {
    _ampSub?.cancel();
    _ttsOrbTimer?.cancel();
    _orb.dispose();
    _input.dispose();
    _scroll.dispose();
    unawaited(_tts.stop());
    unawaited(() async {
      if (await _recorder.isRecording()) {
        await _recorder.stop();
      }
      await _recorder.dispose();
    }());
    super.dispose();
  }

  void _scrollBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) {
        return;
      }
      _scroll.animateTo(
        _scroll.position.maxScrollExtent + 80,
        duration: const Duration(milliseconds: 280),
        curve: Curves.easeOut,
      );
    });
  }

  double _dbToLevel(double db) => ((db + 55) / 55).clamp(0.0, 1.0);

  void _pulseOrbForTts() {
    _ttsOrbTimer?.cancel();
    var t = 0.0;
    _ttsOrbTimer = Timer.periodic(const Duration(milliseconds: 50), (_) {
      t += 0.22;
      final smooth = 0.35 + 0.45 * (0.5 + 0.5 * math.sin(t));
      final peak = (smooth + 0.25).clamp(0.0, 1.0);
      _orb.setSpeechEnvelope(smooth, peak);
    });
  }

  Future<void> _maybeAutoplay(String reply) async {
    if (!_autoplayNova || reply.trim().isEmpty) {
      return;
    }
    try {
      _pulseOrbForTts();
      final audio = await widget.api.speakAudio(reply);
      await _tts.playSpeakResult(audio);
    } catch (_) {
      /* TTS optional */
    } finally {
      _ttsOrbTimer?.cancel();
      _orb.applyPreset(NovaVoiceOrbPreset.speaking);
    }
  }

  Future<void> _sendText() async {
    final text = _input.text.trim();
    if (text.isEmpty || _streaming) {
      return;
    }
    _input.clear();
    await _sendWith(text, fromVoice: false);
  }

  Future<void> _sendWith(String text, {required bool fromVoice}) async {
    if (text.isEmpty || _streaming) {
      return;
    }
    setState(() {
      _lines.add(
        _ChatLine(
          id: UniqueKey().toString(),
          isUser: true,
          text: text,
          voiceTranscript: fromVoice ? text : null,
        ),
      );
      _streaming = true;
      _pendingAssistantId = UniqueKey().toString();
      _lines.add(_ChatLine(id: _pendingAssistantId!, isUser: false, text: ""));
    });
    _scrollBottom();
    var assembled = "";
    try {
      await for (final ev in widget.api.chatStreamEvents(text.trim())) {
        if (!mounted) {
          break;
        }
        if (ev is ChatSseTokenEvent) {
          assembled += ev.token;
          final idx = _lines.indexWhere((e) => e.id == _pendingAssistantId);
          if (idx >= 0) {
            setState(() {
              _lines[idx] = _ChatLine(id: _pendingAssistantId!, isUser: false, text: assembled);
            });
            _scrollBottom();
          }
        } else if (ev is ChatSseDoneEvent) {
          final reply = ev.reply.isNotEmpty ? ev.reply : assembled;
          final idx = _lines.indexWhere((e) => e.id == _pendingAssistantId);
          if (idx >= 0) {
            setState(() {
              _lines[idx] = _ChatLine(id: _pendingAssistantId!, isUser: false, text: reply);
            });
          }
          await _maybeAutoplay(reply);
        } else if (ev is ChatSseErrorEvent) {
          throw Exception(ev.message);
        }
      }
    } catch (_) {
      try {
        final fb = await widget.api.chat(text.trim());
        final idx = _lines.indexWhere((e) => e.id == _pendingAssistantId);
        if (idx >= 0 && mounted) {
          setState(() {
            _lines[idx] = _ChatLine(id: _pendingAssistantId!, isUser: false, text: fb);
          });
          await _maybeAutoplay(fb);
        }
      } catch (e2) {
        final idx = _lines.indexWhere((e) => e.id == _pendingAssistantId);
        if (idx >= 0 && mounted) {
          setState(() {
            _lines[idx] = _ChatLine(id: _pendingAssistantId!, isUser: false, text: "Error: $e2");
          });
        }
      }
    } finally {
      if (mounted) {
        setState(() => _streaming = false);
      }
      _pendingAssistantId = null;
    }
  }

  Future<void> _toggleVoiceNote() async {
    if (_streaming) {
      return;
    }
    if (!_recording) {
      final st = await Permission.microphone.request();
      if (!st.isGranted) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Microphone denied")));
        }
        return;
      }
      final dir = await getTemporaryDirectory();
      final ext = Platform.isWindows ? "wav" : "m4a";
      final path = "${dir.path}/nova_vm_${DateTime.now().microsecondsSinceEpoch}.$ext";
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
      setState(() => _recording = true);
      return;
    }
    await _ampSub?.cancel();
    _ampSub = null;
    setState(() => _recording = false);
    _orb.applyPreset(NovaVoiceOrbPreset.speaking);
    try {
      final path = await _recorder.stop();
      if (path == null) {
        throw Exception("no file");
      }
      final bytes = await File(path).readAsBytes();
      final mime = Platform.isWindows ? "audio/wav" : "audio/mp4";
      final transcript = await widget.api.transcribeAudioBytes(bytes, mimeType: mime);
      if (transcript.trim().isEmpty) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("No speech in recording")));
        }
        return;
      }
      await _sendWith(transcript.trim(), fromVoice: true);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text("Voice note failed: $e")));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Column(
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [NovaTheme.surface2.withValues(alpha: 0.95), NovaTheme.surface.withValues(alpha: 0.4)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            border: Border(bottom: BorderSide(color: Colors.white.withValues(alpha: 0.06))),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              DecoratedBox(
                decoration: BoxDecoration(shape: BoxShape.circle, boxShadow: NovaTheme.softGlow(NovaTheme.accent)),
                child: NovaVoiceOrb(controller: _orb, size: 76, preset: NovaVoiceOrbPreset.speaking, baseColor: NovaTheme.accent),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: SwitchListTile.adaptive(
                  contentPadding: EdgeInsets.zero,
                  title: const Text("Autoplay voice"),
                  subtitle: Text("TTS after replies", style: TextStyle(color: Colors.white.withValues(alpha: 0.55), fontSize: 12)),
                  value: _autoplayNova,
                  onChanged: _streaming ? null : (v) => setState(() => _autoplayNova = v),
                ),
              ),
              IconButton.filledTonal(
                tooltip: "Walkie session",
                onPressed: () {
                  Navigator.of(context).push<void>(
                    MaterialPageRoute<void>(builder: (_) => VoiceSessionPage(api: widget.api)),
                  );
                },
                icon: const Icon(Icons.mic_rounded),
              ),
              IconButton.filled(
                tooltip: "WebRTC call (gateway)",
                onPressed: () {
                  Navigator.of(context).push<void>(
                    MaterialPageRoute<void>(builder: (_) => WebrtcCallPage(api: widget.api)),
                  );
                },
                icon: const Icon(Icons.call_rounded),
              ),
            ],
          ),
        ),
        Expanded(
          child: ListView.builder(
            controller: _scroll,
            padding: const EdgeInsets.fromLTRB(14, 14, 14, 10),
            itemCount: _lines.length,
            itemBuilder: (context, i) {
              final m = _lines[i];
              final user = m.isUser;
              final bubble = user
                  ? LinearGradient(colors: [cs.primary.withValues(alpha: 0.35), cs.primary.withValues(alpha: 0.18)])
                  : LinearGradient(colors: [NovaTheme.surface2.withValues(alpha: 0.92), NovaTheme.surface.withValues(alpha: 0.75)]);
              return Align(
                alignment: user ? Alignment.centerRight : Alignment.centerLeft,
                child: Container(
                  margin: const EdgeInsets.symmetric(vertical: 5),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.9),
                  decoration: BoxDecoration(
                    gradient: bubble,
                    borderRadius: BorderRadius.only(
                      topLeft: const Radius.circular(18),
                      topRight: const Radius.circular(18),
                      bottomLeft: Radius.circular(user ? 18 : 4),
                      bottomRight: Radius.circular(user ? 4 : 18),
                    ),
                    border: Border.all(color: Colors.white.withValues(alpha: 0.07)),
                    boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.22), blurRadius: 18, offset: const Offset(0, 8))],
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        user ? "You" : "Nova",
                        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Colors.white.withValues(alpha: 0.55)),
                      ),
                      if (m.voiceTranscript != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Row(
                            children: [
                              Icon(Icons.graphic_eq_rounded, size: 14, color: Colors.white.withValues(alpha: 0.55)),
                              const SizedBox(width: 6),
                              Text("Voice message", style: TextStyle(fontSize: 11, color: Colors.white.withValues(alpha: 0.58))),
                            ],
                          ),
                        ),
                      const SizedBox(height: 6),
                      SelectableText(m.text, style: TextStyle(color: Colors.white.withValues(alpha: 0.92), height: 1.35)),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
        if (_streaming) const LinearProgressIndicator(minHeight: 2),
        Padding(
          padding: const EdgeInsets.fromLTRB(10, 6, 10, 12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              IconButton.filledTonal(
                tooltip: _recording ? "Stop & send voice note" : "Record voice note",
                style: IconButton.styleFrom(backgroundColor: _recording ? Colors.red.withValues(alpha: 0.35) : null),
                onPressed: _toggleVoiceNote,
                icon: Icon(_recording ? Icons.stop_rounded : Icons.mic_rounded),
              ),
              const SizedBox(width: 6),
              Expanded(
                child: TextField(
                  controller: _input,
                  minLines: 1,
                  maxLines: 5,
                  style: const TextStyle(fontSize: 15),
                  decoration: const InputDecoration(
                    hintText: "Message Nova…",
                    isDense: true,
                    contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  ),
                  onSubmitted: (_) => _sendText(),
                ),
              ),
              const SizedBox(width: 6),
              IconButton.filled(
                onPressed: _streaming ? null : _sendText,
                icon: const Icon(Icons.arrow_upward_rounded),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
