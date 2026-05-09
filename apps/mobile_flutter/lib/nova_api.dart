import "dart:async";
import "dart:convert";
import "dart:io";
import "dart:typed_data";

import "package:dio/dio.dart";
import "package:flutter_secure_storage/flutter_secure_storage.dart";

/// One SSE block from `POST /v1/chat/stream`.
sealed class ChatSseEvent {}

class ChatSseTokenEvent extends ChatSseEvent {
  ChatSseTokenEvent(this.token);
  final String token;
}

class ChatSseDoneEvent extends ChatSseEvent {
  ChatSseDoneEvent({required this.reply, this.provider, this.model});
  final String reply;
  final String? provider;
  final String? model;
}

class ChatSseErrorEvent extends ChatSseEvent {
  ChatSseErrorEvent(this.message);
  final String message;
}

class SpeakAudioResult {
  SpeakAudioResult({required this.bytes, required this.mimeType});
  final Uint8List bytes;
  final String mimeType;
}

class NovaApi {
  NovaApi({required String baseUrl}) : baseUrl = baseUrl.trim().replaceAll(RegExp(r"/+$"), ""), _dio = Dio(BaseOptions(baseUrl: baseUrl.trim().replaceAll(RegExp(r"/+$"), "")));

  String baseUrl;
  final Dio _dio;
  final FlutterSecureStorage _storage = const FlutterSecureStorage();
  static const String _tokenKey = "nova_session_token";

  Future<void> saveToken(String token) async => _storage.write(key: _tokenKey, value: token);
  Future<String?> readToken() async => _storage.read(key: _tokenKey);
  Future<void> clearToken() async => _storage.delete(key: _tokenKey);

  static const String _gatewayKey = "nova_voice_gateway_url";

  Future<void> saveBaseUrl(String url) async {
    final t = url.trim();
    if (t.isEmpty) return;
    await _storage.write(key: "nova_api_base_url", value: t.replaceAll(RegExp(r"/+$"), ""));
  }

  Future<String?> readSavedBaseUrl() async => _storage.read(key: "nova_api_base_url");

  Future<void> saveVoiceGatewayUrl(String url) async {
    final t = url.trim();
    if (t.isEmpty) return;
    await _storage.write(key: _gatewayKey, value: t.replaceAll(RegExp(r"/+$"), ""));
  }

  Future<String?> readVoiceGatewayUrl() async => _storage.read(key: _gatewayKey);

  /// Suggested gateway HTTP base (`http://host:8790`) derived from the current agent [baseUrl].
  String defaultVoiceGatewayHttpBase() {
    try {
      final u = Uri.parse(baseUrl);
      final host = u.host.isEmpty ? "127.0.0.1" : u.host;
      final scheme = u.scheme == "https" ? "https" : "http";
      return Uri(scheme: scheme, host: host, port: 8790).toString();
    } catch (_) {
      return "http://127.0.0.1:8790";
    }
  }

  /// `GET /v1/ice` on the voice gateway (not agent-core).
  Future<List<Map<String, dynamic>>> fetchGatewayIce(String gatewayHttpBase) async {
    final root = gatewayHttpBase.trim().replaceAll(RegExp(r"/+$"), "");
    final r = await Dio().get<Map<String, dynamic>>("$root/v1/ice");
    final raw = r.data?["iceServers"];
    if (raw is! List) {
      return [];
    }
    return raw.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  void applyBaseUrl(String url) {
    final t = url.trim().replaceAll(RegExp(r"/+$"), "");
    baseUrl = t;
    _dio.options.baseUrl = t;
  }

  Future<Map<String, dynamic>> login(String email, String password) async {
    final response = await _dio.post(
      "/v1/auth/login",
      data: {"email": email, "password": password},
    );
    return Map<String, dynamic>.from(response.data as Map);
  }

  Future<Map<String, dynamic>> health() async {
    final token = await readToken();
    final response = await _dio.get(
      "/v1/system/health/full",
      options: Options(headers: _headers(token)),
    );
    return Map<String, dynamic>.from(response.data as Map);
  }

  Future<List<Map<String, dynamic>>> approvals() async {
    final token = await readToken();
    final response = await _dio.get("/v1/approvals", options: Options(headers: _headers(token)));
    final items = (response.data as Map)["items"] as List? ?? const [];
    return items.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  Future<void> approve(String id) async {
    final token = await readToken();
    await _dio.post(
      "/v1/approvals/approve",
      data: {"id": id},
      options: Options(headers: _headers(token)),
    );
  }

  Future<String> chat(String message) async {
    final token = await readToken();
    final response = await _dio.post(
      "/v1/chat",
      data: {"message": message},
      options: Options(headers: _headers(token)),
    );
    final data = Map<String, dynamic>.from(response.data as Map);
    return (data["reply"] ?? "").toString();
  }

  /// Parses `text/event-stream` from agent-core (`event:` / `data:` blocks, blank line between events).
  Stream<ChatSseEvent> chatStreamEvents(String message) async* {
    final token = await readToken();
    final client = HttpClient();
    try {
      final uri = Uri.parse("$baseUrl/v1/chat/stream");
      final req = await client.postUrl(uri);
      req.headers.set(HttpHeaders.contentTypeHeader, "application/json");
      if (token != null && token.isNotEmpty) {
        req.headers.set("x-session-token", token);
      }
      req.add(utf8.encode(jsonEncode({"message": message})));
      final res = await req.close();
      if (res.statusCode >= 400) {
        final body = await utf8.decoder.bind(res).join();
        yield ChatSseErrorEvent("stream failed (${res.statusCode}): $body");
        return;
      }
      var carry = "";
      String? currentEvent;
      await for (final chunk in utf8.decoder.bind(res)) {
        carry += chunk;
        while (true) {
          final sep = carry.indexOf("\n\n");
          if (sep < 0) break;
          final block = carry.substring(0, sep);
          carry = carry.substring(sep + 2);
          currentEvent = null;
          for (final line in block.split("\n")) {
            if (line.startsWith("event: ")) {
              currentEvent = line.substring(7).trim();
            } else if (line.startsWith("data: ")) {
              final raw = line.substring(6).trim();
              if (raw.isEmpty) continue;
              final dynamic parsed = jsonDecode(raw);
              final ev = currentEvent ?? "";
              if (ev == "token" && parsed is Map<String, dynamic>) {
                final t = (parsed["token"] ?? "").toString();
                if (t.isNotEmpty) yield ChatSseTokenEvent(t);
              } else if (ev == "done" && parsed is Map<String, dynamic>) {
                yield ChatSseDoneEvent(
                  reply: (parsed["reply"] ?? "").toString(),
                  provider: parsed["provider"]?.toString(),
                  model: parsed["model"]?.toString(),
                );
              } else if (ev == "error" && parsed is Map<String, dynamic>) {
                yield ChatSseErrorEvent((parsed["error"] ?? "error").toString());
              }
            }
          }
        }
      }
    } finally {
      client.close(force: true);
    }
  }

  /// Backwards-compatible token stream (drops metadata).
  Stream<String> chatStream(String message) async* {
    await for (final ev in chatStreamEvents(message)) {
      if (ev is ChatSseTokenEvent) {
        yield ev.token;
      } else if (ev is ChatSseErrorEvent) {
        throw Exception(ev.message);
      }
    }
  }

  Future<String> transcribeAudioBytes(Uint8List bytes, {String mimeType = "audio/wav"}) async {
    final token = await readToken();
    final b64 = base64Encode(bytes);
    final response = await _dio.post(
      "/v1/voice/transcribe-audio",
      data: {"audioBase64": b64, "mimeType": mimeType},
      options: Options(headers: _headers(token)),
    );
    final data = Map<String, dynamic>.from(response.data as Map);
    return (data["text"] ?? "").toString();
  }

  /// TTS audio bytes (`/v1/voice/speak-audio`) — same pipeline as WebUI read-aloud.
  Future<SpeakAudioResult> speakAudio(String text) async {
    final token = await readToken();
    final response = await _dio.post<List<int>>(
      "/v1/voice/speak-audio",
      data: {"text": _stripForTts(text)},
      options: Options(
        headers: {
          ..._headers(token),
          HttpHeaders.contentTypeHeader: "application/json",
        },
        responseType: ResponseType.bytes,
      ),
    );
    final mime = response.headers.value(HttpHeaders.contentTypeHeader) ?? "audio/wav";
    final raw = response.data;
    if (raw == null) {
      throw Exception("empty TTS response");
    }
    return SpeakAudioResult(bytes: Uint8List.fromList(raw), mimeType: mime);
  }

  Future<List<Map<String, dynamic>>> thoughts() async {
    final token = await readToken();
    final response = await _dio.get("/v1/thoughts", options: Options(headers: _headers(token)));
    final data = Map<String, dynamic>.from(response.data as Map);
    final items = data["items"] as List? ?? const [];
    return items.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  Future<Map<String, dynamic>> registerPush({
    required String platform,
    required String token,
    String? appVersion,
  }) async {
    final session = await readToken();
    final response = await _dio.post(
      "/v1/mobile/push/register",
      data: {"platform": platform, "token": token, "appVersion": appVersion},
      options: Options(headers: _headers(session)),
    );
    return Map<String, dynamic>.from(response.data as Map);
  }

  Map<String, String> _headers(String? token) {
    if (token == null || token.isEmpty) return {};
    return {"x-session-token": token};
  }
}

String _stripForTts(String raw) {
  var s = raw;
  for (final re in [
    RegExp(r"<thinking>[\s\S]*?</thinking>", caseSensitive: false),
    RegExp(r"<reasoning>[\s\S]*?</reasoning>", caseSensitive: false),
    RegExp(r"<think>[\s\S]*?</think>", caseSensitive: false),
  ]) {
    s = s.replaceAll(re, "");
  }
  s = s.trim();
  s = s.replaceAllMapped(RegExp(r"```[\s\S]*?```"), (_) => " ");
  return s.trim();
}
