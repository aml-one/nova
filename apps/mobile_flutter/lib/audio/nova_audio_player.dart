import "dart:io";

import "package:audioplayers/audioplayers.dart";
import "package:path_provider/path_provider.dart";

import "../nova_api.dart";

/// Plays TTS bytes from `/v1/voice/speak-audio` (same as WebUI read-aloud).
class NovaAudioPlayer {
  NovaAudioPlayer() {
    _player.onPlayerComplete.listen((_) {
      _playing = false;
    });
  }

  final AudioPlayer _player = AudioPlayer();
  bool _playing = false;

  bool get isPlaying => _playing;

  Future<void> stop() async {
    await _player.stop();
    _playing = false;
  }

  Future<void> playSpeakResult(SpeakAudioResult result) async {
    await stop();
    final dir = await getTemporaryDirectory();
    var ext = "wav";
    final m = result.mimeType.toLowerCase();
    if (m.contains("mpeg") || m.contains("mp3")) {
      ext = "mp3";
    } else if (m.contains("ogg") || m.contains("opus")) {
      ext = "opus";
    }
    final file = File("${dir.path}/nova_tts_${DateTime.now().microsecondsSinceEpoch}.$ext");
    await file.writeAsBytes(result.bytes, flush: true);
    _playing = true;
    await _player.play(DeviceFileSource(file.path));
  }

  Stream<Duration> get onPosition => _player.onPositionChanged;
  Stream<PlayerState> get onState => _player.onPlayerStateChanged;
}
