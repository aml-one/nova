import "dart:async";
import "dart:convert";

import "package:flutter/material.dart";
import "package:flutter/services.dart";
import "package:flutter_webrtc/flutter_webrtc.dart";
import "package:web_socket_channel/web_socket_channel.dart";

import "../nova_api.dart";

/// Duplex voice via Python `apps/voice-webrtc-gateway` (WebRTC + agent-core STT/chat/TTS).
class WebrtcCallPage extends StatefulWidget {
  const WebrtcCallPage({super.key, required this.api});

  final NovaApi api;

  @override
  State<WebrtcCallPage> createState() => _WebrtcCallPageState();
}

class _WebrtcCallPageState extends State<WebrtcCallPage> {
  final TextEditingController _gateway = TextEditingController();
  WebSocketChannel? _ws;
  RTCPeerConnection? _pc;
  MediaStream? _local;
  StreamSubscription<dynamic>? _sub;
  String _status = "Idle";
  bool _busy = false;
  String _serverCtl = "";
  bool _ctlBusy = false;

  @override
  void initState() {
    super.initState();
    _bootstrapGatewayField();
    unawaited(_refreshServerGatewayCtl());
  }

  Future<void> _refreshServerGatewayCtl() async {
    try {
      final m = await widget.api.voiceGatewayStatus();
      if (!mounted) {
        return;
      }
      setState(() {
        _serverCtl =
            "launchd=${m['launchdLoaded']}  http=${m['healthy']}  macOS control=${m['controlSupported']}  plist=${m['plistPresent']}";
      });
    } catch (e) {
      if (mounted) {
        setState(() => _serverCtl = "Server status: $e");
      }
    }
  }

  Future<void> _postCtl(Future<Map<String, dynamic>> Function() fn) async {
    setState(() => _ctlBusy = true);
    try {
      final r = await fn();
      if (mounted) {
        setState(() => _status = "${r['ok'] == true ? 'OK' : 'Failed'}: ${r['message'] ?? r.toString()}");
      }
    } catch (e) {
      if (mounted) {
        setState(() => _status = "Control error: $e");
      }
    } finally {
      if (mounted) {
        setState(() => _ctlBusy = false);
      }
      await _refreshServerGatewayCtl();
    }
  }

  Future<void> _bootstrapGatewayField() async {
    final saved = await widget.api.readVoiceGatewayUrl();
    if (!mounted) {
      return;
    }
    setState(() {
      _gateway.text = (saved != null && saved.isNotEmpty) ? saved : widget.api.defaultVoiceGatewayHttpBase();
    });
  }

  @override
  void dispose() {
    unawaited(_hangup());
    _gateway.dispose();
    super.dispose();
  }

  Uri _gatewayWs(String httpBase) {
    final u = Uri.parse(httpBase.trim());
    final port = u.hasPort ? u.port : 8790;
    final scheme = u.scheme == "https" ? "wss" : "ws";
    return Uri(scheme: scheme, host: u.host, port: port, path: "/ws/voice");
  }

  Future<void> _hangup() async {
    await _sub?.cancel();
    _sub = null;
    await _ws?.sink.close();
    _ws = null;
    if (_local != null) {
      for (final t in _local!.getTracks()) {
        await t.stop();
      }
      await _local!.dispose();
      _local = null;
    }
    await _pc?.close();
    _pc = null;
  }

  Future<void> _connect() async {
    if (_busy) {
      return;
    }
    setState(() {
      _busy = true;
      _status = "Connecting…";
    });
    await _hangup();
    final token = await widget.api.readToken();
    if (token == null || token.isEmpty) {
      setState(() {
        _status = "Not signed in";
        _busy = false;
      });
      return;
    }
    final httpBase = _gateway.text.trim();
    await widget.api.saveVoiceGatewayUrl(httpBase);

    WebSocketChannel? ws;
    try {
      ws = WebSocketChannel.connect(_gatewayWs(httpBase));
      _ws = ws;

      final icePrefetch = await widget.api.fetchGatewayIce(httpBase);

      final completer = Completer<void>();
      String? err;

      _sub = ws.stream.listen(
        (raw) async {
          final msg = jsonDecode(raw as String) as Map<String, dynamic>;
          final t = msg["type"] as String?;
          if (t == "error") {
            err = msg["message"]?.toString() ?? "error";
            if (!completer.isCompleted) {
              completer.completeError(Exception(err));
            }
            return;
          }
          if (t == "auth_ok") {
            final fromAuth = msg["iceServers"];
            final servers = <Map<String, dynamic>>[];
            if (fromAuth is List) {
              for (final e in fromAuth) {
                if (e is Map) {
                  servers.add(Map<String, dynamic>.from(e));
                }
              }
            }
            if (servers.isEmpty) {
              servers.addAll(icePrefetch);
            }
            try {
              await _startPeer(servers, ws!);
              if (!completer.isCompleted) {
                completer.complete();
              }
              if (mounted) {
                setState(() => _status = "Live — speak; Nova replies over the call.");
              }
            } catch (e) {
              if (!completer.isCompleted) {
                completer.completeError(e);
              }
            }
            return;
          }
          if (t == "answer" && _pc != null) {
            final sdp = msg["sdp"]?.toString() ?? "";
            await _pc!.setRemoteDescription(RTCSessionDescription(sdp, "answer"));
            return;
          }
          if (t == "ice" && _pc != null) {
            final c = msg["candidate"];
            if (c is Map && c["candidate"] != null) {
              await _pc!.addCandidate(
                RTCIceCandidate(
                  c["candidate"]?.toString(),
                  c["sdpMid"]?.toString(),
                  c["sdpMLineIndex"] is int ? c["sdpMLineIndex"] as int : int.tryParse("${c["sdpMLineIndex"]}"),
                ),
              );
            }
            return;
          }
        },
        onError: (e) {
          if (!completer.isCompleted) {
            completer.completeError(e);
          }
        },
        onDone: () {},
      );

      ws.sink.add(jsonEncode({"type": "auth", "token": token}));
      await completer.future.timeout(const Duration(seconds: 45));
      try {
        await Helper.setSpeakerphoneOn(true);
      } on MissingPluginException {
        // Windows/Linux: `enableSpeakerphone` is not implemented on FlutterWebRTC.Method.
        // Call still works; OS uses the default playback device.
      }
    } catch (e) {
      await _hangup();
      if (mounted) {
        setState(() => _status = "Failed: $e");
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _startPeer(List<Map<String, dynamic>> iceServers, WebSocketChannel ws) async {
    final config = <String, dynamic>{
      "sdpSemantics": "unified-plan",
      "iceServers": iceServers,
    };
    final pc = await createPeerConnection(config);
    _pc = pc;

    pc.onIceCandidate = (RTCIceCandidate? c) {
      if (c == null) {
        return;
      }
      ws.sink.add(
        jsonEncode({
          "type": "ice",
          "candidate": {
            "candidate": c.candidate,
            "sdpMid": c.sdpMid,
            "sdpMLineIndex": c.sdpMLineIndex,
          },
        }),
      );
    };

    pc.onTrack = (RTCTrackEvent e) {
      if (e.track.kind == "audio") {
        e.streams.isNotEmpty ? e.streams.first : null;
      }
    };

    final local = await navigator.mediaDevices.getUserMedia({"audio": true, "video": false});
    _local = local;
    for (final t in local.getAudioTracks()) {
      await pc.addTrack(t, local);
    }

    final offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.sink.add(jsonEncode({"type": "offer", "sdp": offer.sdp}));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      extendBodyBehindAppBar: true,
      appBar: AppBar(title: const Text("WebRTC voice")),
      body: ListView(
        padding: EdgeInsets.fromLTRB(20, kToolbarHeight + MediaQuery.paddingOf(context).top + 16, 20, 24),
        children: [
          Text(
            "Runs the Python gateway in apps/voice-webrtc-gateway (port 8790). "
            "Configure TURN via NOVA_ICE_SERVERS for strict NAT.",
            style: TextStyle(color: Colors.white.withValues(alpha: 0.62), fontSize: 13, height: 1.35),
          ),
          const SizedBox(height: 16),
          Text(
            "Server (agent-core) can start/stop the macOS LaunchDaemon if Nova runs as root. Requires admin when login is enabled.",
            style: TextStyle(color: Colors.white.withValues(alpha: 0.55), fontSize: 12, height: 1.3),
          ),
          const SizedBox(height: 8),
          Text(_serverCtl.isEmpty ? "Loading server gateway status…" : _serverCtl, style: const TextStyle(fontSize: 12)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              TextButton(
                onPressed: _ctlBusy ? null : _refreshServerGatewayCtl,
                child: const Text("Refresh"),
              ),
              TextButton(
                onPressed: _ctlBusy ? null : () => _postCtl(widget.api.voiceGatewayStart),
                child: const Text("Start service"),
              ),
              TextButton(
                onPressed: _ctlBusy ? null : () => _postCtl(widget.api.voiceGatewayStop),
                child: const Text("Stop service"),
              ),
              TextButton(
                onPressed: _ctlBusy ? null : () => _postCtl(widget.api.voiceGatewayRestart),
                child: const Text("Restart service"),
              ),
            ],
          ),
          const SizedBox(height: 20),
          TextField(
            controller: _gateway,
            decoration: const InputDecoration(labelText: "Voice gateway HTTP base"),
            keyboardType: TextInputType.url,
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              FilledButton.icon(
                onPressed: _busy ? null : _connect,
                icon: const Icon(Icons.call_rounded),
                label: Text(_busy ? "Working…" : "Start call"),
              ),
              const SizedBox(width: 12),
              OutlinedButton(
                onPressed: _busy
                    ? null
                    : () async {
                        await _hangup();
                        if (mounted) {
                          setState(() => _status = "Hung up");
                        }
                      },
                child: const Text("Hang up"),
              ),
            ],
          ),
          const SizedBox(height: 20),
          Text(_status, style: const TextStyle(fontSize: 14)),
        ],
      ),
    );
  }
}
