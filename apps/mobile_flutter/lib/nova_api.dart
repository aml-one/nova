import "dart:convert";
import "dart:io";
import "package:dio/dio.dart";
import "package:flutter_secure_storage/flutter_secure_storage.dart";
import "package:web_socket_channel/web_socket_channel.dart";

class NovaApi {
  NovaApi({required this.baseUrl}) : _dio = Dio(BaseOptions(baseUrl: baseUrl));

  final String baseUrl;
  final Dio _dio;
  final FlutterSecureStorage _storage = const FlutterSecureStorage();
  static const String _tokenKey = "nova_session_token";

  Future<void> saveToken(String token) async => _storage.write(key: _tokenKey, value: token);
  Future<String?> readToken() async => _storage.read(key: _tokenKey);
  Future<void> clearToken() async => _storage.delete(key: _tokenKey);

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

  Stream<String> chatStream(String message) async* {
    final token = await readToken();
    final client = HttpClient();
    try {
      final uri = Uri.parse("$baseUrl/v1/chat/stream");
      final req = await client.postUrl(uri);
      req.headers.set("content-type", "application/json");
      if (token != null && token.isNotEmpty) {
        req.headers.set("x-session-token", token);
      }
      req.add(utf8.encode(jsonEncode({"message": message})));
      final res = await req.close();
      if (res.statusCode >= 400) {
        final body = await utf8.decoder.bind(res).join();
        throw Exception("stream failed: $body");
      }
      final lines = utf8.decoder.bind(res).transform(const LineSplitter());
      String? event;
      await for (final line in lines) {
        if (line.startsWith("event: ")) {
          event = line.substring(7).trim();
          continue;
        }
        if (line.startsWith("data: ")) {
          final raw = line.substring(6);
          final parsed = jsonDecode(raw);
          if (event == "token" && parsed is Map<String, dynamic>) {
            final tokenText = (parsed["token"] ?? "").toString();
            if (tokenText.isNotEmpty) {
              yield tokenText;
            }
          }
        }
      }
    } finally {
      client.close(force: true);
    }
  }

  Future<List<Map<String, dynamic>>> thoughts() async {
    final token = await readToken();
    final response = await _dio.get("/v1/thoughts", options: Options(headers: _headers(token)));
    final data = Map<String, dynamic>.from(response.data as Map);
    final items = data["items"] as List? ?? const [];
    return items.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  Stream<Map<String, dynamic>> thoughtStream() async* {
    final token = await readToken();
    final uri = Uri.parse("${baseUrl.replaceFirst("http", "ws")}/v1/thoughts/ws");
    final channel = WebSocketChannel.connect(uri);
    channel.sink.add(jsonEncode({"token": token ?? ""}));
    await for (final event in channel.stream) {
      final parsed = jsonDecode(event as String);
      if (parsed is Map<String, dynamic>) {
        yield parsed;
      }
    }
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
