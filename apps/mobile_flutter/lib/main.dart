import "package:flutter/material.dart";
import "package:flutter/foundation.dart";
import "package:speech_to_text/speech_to_text.dart";
import "package:firebase_core/firebase_core.dart";
import "package:firebase_messaging/firebase_messaging.dart";
import "nova_api.dart";

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const NovaMobileApp());
}

class NovaMobileApp extends StatelessWidget {
  const NovaMobileApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: "Nova Mobile",
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: Colors.purple), useMaterial3: true),
      home: const RootScreen(),
    );
  }
}

class RootScreen extends StatefulWidget {
  const RootScreen({super.key});

  @override
  State<RootScreen> createState() => _RootScreenState();
}

class _RootScreenState extends State<RootScreen> {
  final NovaApi _api = NovaApi(baseUrl: const String.fromEnvironment("NOVA_API_BASE_URL", defaultValue: "http://10.0.2.2:8787"));
  bool _ready = false;
  String? _token;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    await _tryInitFirebaseAndRegisterPush();
    _token = await _api.readToken();
    setState(() => _ready = true);
  }

  Future<void> _tryInitFirebaseAndRegisterPush() async {
    try {
      await Firebase.initializeApp();
      final messaging = FirebaseMessaging.instance;
      await messaging.requestPermission();
      final fcmToken = await messaging.getToken();
      if (fcmToken != null && fcmToken.isNotEmpty) {
        await _api.registerPush(
          platform: defaultTargetPlatform == TargetPlatform.iOS ? "ios" : "android",
          token: fcmToken,
          appVersion: "0.1.0",
        );
      }
    } catch (_) {
      // Firebase optional until project files are configured.
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_ready) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    if (_token == null || _token!.isEmpty) {
      return LoginScreen(api: _api, onLoggedIn: () async {
        _token = await _api.readToken();
        if (mounted) setState(() {});
      });
    }
    return HomeShell(api: _api, onLogout: () async {
      await _api.clearToken();
      setState(() => _token = null);
    });
  }
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.api, required this.onLoggedIn});
  final NovaApi api;
  final Future<void> Function() onLoggedIn;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final TextEditingController _email = TextEditingController();
  final TextEditingController _password = TextEditingController();
  String _error = "";
  bool _loading = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("Nova Login")),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            TextField(controller: _email, decoration: const InputDecoration(labelText: "Email")),
            TextField(controller: _password, obscureText: true, decoration: const InputDecoration(labelText: "Password")),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: _loading ? null : () async {
                setState(() {
                  _loading = true;
                  _error = "";
                });
                try {
                  final data = await widget.api.login(_email.text.trim(), _password.text);
                  final token = (data["token"] ?? "").toString();
                  if (token.isEmpty) throw Exception("No token returned");
                  await widget.api.saveToken(token);
                  await widget.onLoggedIn();
                } catch (e) {
                  setState(() => _error = e.toString());
                } finally {
                  if (mounted) setState(() => _loading = false);
                }
              },
              child: Text(_loading ? "Signing in..." : "Sign in"),
            ),
            if (_error.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error, style: const TextStyle(color: Colors.red))),
          ],
        ),
      ),
    );
  }
}

class HomeShell extends StatefulWidget {
  const HomeShell({super.key, required this.api, required this.onLogout});
  final NovaApi api;
  final Future<void> Function() onLogout;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final pages = [
      DashboardPage(api: widget.api),
      ApprovalsPage(api: widget.api),
      ChatPage(api: widget.api),
      ThoughtsPage(api: widget.api),
    ];
    return Scaffold(
      appBar: AppBar(
        title: const Text("Nova Mobile"),
        actions: [IconButton(onPressed: () => widget.onLogout(), icon: const Icon(Icons.logout))],
      ),
      body: pages[_index],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.dashboard), label: "Dashboard"),
          NavigationDestination(icon: Icon(Icons.approval), label: "Approvals"),
          NavigationDestination(icon: Icon(Icons.chat), label: "Chat"),
          NavigationDestination(icon: Icon(Icons.psychology), label: "Thoughts"),
        ],
      ),
    );
  }
}

class DashboardPage extends StatefulWidget {
  const DashboardPage({super.key, required this.api});
  final NovaApi api;
  @override
  State<DashboardPage> createState() => _DashboardPageState();
}

class _DashboardPageState extends State<DashboardPage> {
  Map<String, dynamic> _health = {};

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    final data = await widget.api.health();
    if (mounted) setState(() => _health = data);
  }

  @override
  Widget build(BuildContext context) {
    final checks = (_health["health"] as Map?)?["checks"] as List? ?? const [];
    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: ListTile(
              title: const Text("System health"),
              subtitle: Text("Level: ${((_health["health"] as Map?)?["level"] ?? "unknown").toString()}"),
              trailing: IconButton(onPressed: _refresh, icon: const Icon(Icons.refresh)),
            ),
          ),
          ...checks.take(12).map((item) {
            final row = item as Map;
            return Card(child: ListTile(title: Text((row["name"] ?? "").toString()), subtitle: Text((row["detail"] ?? "").toString())));
          }),
        ],
      ),
    );
  }
}

class ApprovalsPage extends StatefulWidget {
  const ApprovalsPage({super.key, required this.api});
  final NovaApi api;
  @override
  State<ApprovalsPage> createState() => _ApprovalsPageState();
}

class _ApprovalsPageState extends State<ApprovalsPage> {
  List<Map<String, dynamic>> _items = [];
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final rows = await widget.api.approvals();
    if (mounted) setState(() => _items = rows);
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: _items.map((item) {
          final id = (item["id"] ?? "").toString();
          return Card(
            child: ListTile(
              title: Text((item["command"] ?? "approval").toString()),
              subtitle: Text("Risk: ${(item["risk_level"] ?? "-").toString()}"),
              trailing: FilledButton(
                onPressed: id.isEmpty ? null : () async {
                  await widget.api.approve(id);
                  await _load();
                },
                child: const Text("Approve"),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}

class ChatPage extends StatefulWidget {
  const ChatPage({super.key, required this.api});
  final NovaApi api;
  @override
  State<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends State<ChatPage> {
  final TextEditingController _input = TextEditingController();
  final List<String> _messages = [];
  final SpeechToText _stt = SpeechToText();
  bool _streaming = false;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: _messages.map((e) => Card(child: Padding(padding: const EdgeInsets.all(12), child: Text(e)))).toList(),
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              IconButton(
                onPressed: () async {
                  final available = await _stt.initialize();
                  if (!available) return;
                  await _stt.listen(onResult: (result) {
                    _input.text = result.recognizedWords;
                  });
                },
                icon: const Icon(Icons.mic),
              ),
              Expanded(child: TextField(controller: _input, decoration: const InputDecoration(hintText: "Message Nova"))),
              IconButton(
                onPressed: () async {
                  final text = _input.text.trim();
                  if (text.isEmpty || _streaming) return;
                  setState(() => _messages.add("You: $text"));
                  _input.clear();
                  setState(() {
                    _streaming = true;
                    _messages.add("Nova: ");
                  });
                  String assembled = "";
                  try {
                    await for (final token in widget.api.chatStream(text)) {
                      assembled += token;
                      if (!mounted) break;
                      setState(() {
                        _messages[_messages.length - 1] = "Nova: $assembled";
                      });
                    }
                    if (assembled.isEmpty) {
                      final fallback = await widget.api.chat(text);
                      if (mounted) {
                        setState(() {
                          _messages[_messages.length - 1] = "Nova: $fallback";
                        });
                      }
                    }
                  } catch (_) {
                    final fallback = await widget.api.chat(text);
                    if (mounted) {
                      setState(() {
                        _messages[_messages.length - 1] = "Nova: $fallback";
                      });
                    }
                  } finally {
                    if (mounted) setState(() => _streaming = false);
                  }
                },
                icon: const Icon(Icons.send),
              )
            ],
          ),
        )
      ],
    );
  }
}

class ThoughtsPage extends StatefulWidget {
  const ThoughtsPage({super.key, required this.api});
  final NovaApi api;
  @override
  State<ThoughtsPage> createState() => _ThoughtsPageState();
}

class _ThoughtsPageState extends State<ThoughtsPage> {
  List<Map<String, dynamic>> _items = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final rows = await widget.api.thoughts();
    if (mounted) setState(() => _items = rows);
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: _items.take(80).map((item) {
          return Card(
            child: ListTile(
              title: Text((item["title"] ?? "").toString()),
              subtitle: Text((item["content"] ?? "").toString()),
            ),
          );
        }).toList(),
      ),
    );
  }
}
