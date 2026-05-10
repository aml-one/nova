import "package:firebase_core/firebase_core.dart";
import "package:firebase_messaging/firebase_messaging.dart";
import "package:flutter/foundation.dart";
import "package:flutter/material.dart";

import "nova_api.dart";
import "screens/chat_page.dart";
import "theme/nova_theme.dart";
import "widgets/nova_voice_orb.dart";

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const NovaMobileApp());
}

class NovaMobileApp extends StatelessWidget {
  const NovaMobileApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: "Nova",
      debugShowCheckedModeBanner: false,
      theme: NovaTheme.dark(),
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
  late NovaApi _api;
  bool _ready = false;
  String? _token;

  @override
  void initState() {
    super.initState();
    const fromEnv = String.fromEnvironment("NOVA_API_BASE_URL", defaultValue: "http://127.0.0.1:8787");
    _api = NovaApi(baseUrl: fromEnv);
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    await _tryInitFirebaseAndRegisterPush();
    final saved = await _api.readSavedBaseUrl();
    if (saved != null && saved.isNotEmpty) {
      _api.applyBaseUrl(saved);
    }
    _token = await _api.readToken();
    if (mounted) {
      setState(() => _ready = true);
    }
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
          appVersion: "1.0.0",
        );
      }
    } catch (_) {
      // Firebase optional until project files are configured.
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_ready) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (_token == null || _token!.isEmpty) {
      return LoginScreen(
        api: _api,
        onLoggedIn: () async {
          _token = await _api.readToken();
          if (mounted) {
            setState(() {});
          }
        },
      );
    }
    return HomeShell(
      api: _api,
      onLogout: () async {
        await _api.clearToken();
        setState(() => _token = null);
      },
    );
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
  final TextEditingController _server = TextEditingController();
  final TextEditingController _email = TextEditingController();
  final TextEditingController _password = TextEditingController();
  final NovaVoiceOrbController _orbDeco = NovaVoiceOrbController();
  String _error = "";
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _server.text = widget.api.baseUrl;
    _orbDeco.applyPreset(NovaVoiceOrbPreset.calm);
  }

  @override
  void dispose() {
    _orbDeco.dispose();
    _server.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        width: double.infinity,
        height: double.infinity,
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            colors: [Color(0xFF050810), NovaTheme.canvas, Color(0xFF0E1A2E)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
        child: SafeArea(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(22, 12, 22, 28),
            children: [
              const SizedBox(height: 12),
              Center(
                child: Column(
                  children: [
                    Text("Nova", style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700, letterSpacing: 0.5)),
                    const SizedBox(height: 6),
                    Text("Companion", style: TextStyle(color: Colors.white.withValues(alpha: 0.5), fontSize: 13)),
                    const SizedBox(height: 18),
                    DecoratedBox(
                      decoration: BoxDecoration(shape: BoxShape.circle, boxShadow: NovaTheme.softGlow(NovaTheme.accent)),
                      child: NovaVoiceOrb(controller: _orbDeco, size: 112, preset: NovaVoiceOrbPreset.calm, baseColor: NovaTheme.accent),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 28),
              Text(
                "Agent URL (same as WebUI). Android emulator: http://10.0.2.2:8787 — device: your LAN IP.",
                style: TextStyle(fontSize: 12, color: Colors.white.withValues(alpha: 0.55), height: 1.35),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: _server,
                decoration: const InputDecoration(labelText: "Nova API base URL"),
                keyboardType: TextInputType.url,
              ),
              const SizedBox(height: 12),
              TextField(controller: _email, decoration: const InputDecoration(labelText: "Email")),
              const SizedBox(height: 10),
              TextField(controller: _password, obscureText: true, decoration: const InputDecoration(labelText: "Password")),
              const SizedBox(height: 22),
              FilledButton(
                onPressed: _loading
                    ? null
                    : () async {
                        setState(() {
                          _loading = true;
                          _error = "";
                        });
                        try {
                          widget.api.applyBaseUrl(_server.text.trim());
                          await widget.api.saveBaseUrl(_server.text.trim());
                          final data = await widget.api.login(_email.text.trim(), _password.text);
                          final token = (data["token"] ?? "").toString();
                          if (token.isEmpty) {
                            throw Exception("No token returned");
                          }
                          await widget.api.saveToken(token);
                          await widget.onLoggedIn();
                        } catch (e) {
                          setState(() => _error = e.toString());
                        } finally {
                          if (mounted) {
                            setState(() => _loading = false);
                          }
                        }
                      },
                child: Text(_loading ? "Signing in…" : "Sign in"),
              ),
              if (_error.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 14),
                  child: Text(_error, style: const TextStyle(color: Colors.redAccent)),
                ),
            ],
          ),
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
        title: const Text("Nova"),
        actions: [
          IconButton(onPressed: () => widget.onLogout(), icon: const Icon(Icons.logout_rounded)),
        ],
      ),
      body: pages[_index],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.dashboard_rounded), label: "Home"),
          NavigationDestination(icon: Icon(Icons.approval_rounded), label: "Approvals"),
          NavigationDestination(icon: Icon(Icons.chat_bubble_rounded), label: "Chat"),
          NavigationDestination(icon: Icon(Icons.auto_awesome_rounded), label: "Thoughts"),
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
    if (mounted) {
      setState(() => _health = data);
    }
  }

  @override
  Widget build(BuildContext context) {
    final checks = (_health["health"] as Map?)?["checks"] as List? ?? const [];
    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          Card(
            elevation: 0,
            color: NovaTheme.surface2.withValues(alpha: 0.85),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
            child: ListTile(
              title: const Text("System health"),
              subtitle: Text("Level: ${((_health["health"] as Map?)?["level"] ?? "unknown").toString()}"),
              trailing: IconButton(onPressed: _refresh, icon: const Icon(Icons.refresh_rounded)),
            ),
          ),
          ...checks.take(12).map((item) {
            final row = item as Map;
            return Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Card(
                elevation: 0,
                color: NovaTheme.surface.withValues(alpha: 0.65),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                child: ListTile(
                  title: Text((row["name"] ?? "").toString()),
                  subtitle: Text((row["detail"] ?? "").toString(), style: TextStyle(color: Colors.white.withValues(alpha: 0.55))),
                ),
              ),
            );
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
    if (mounted) {
      setState(() => _items = rows);
    }
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: _items.map((item) {
          final id = (item["id"] ?? "").toString();
          return Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Card(
              elevation: 0,
              color: NovaTheme.surface2.withValues(alpha: 0.88),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              child: ListTile(
                title: Text((item["command"] ?? "approval").toString()),
                subtitle: Text("Risk: ${(item["risk_level"] ?? "-").toString()}"),
                trailing: FilledButton(
                  onPressed: id.isEmpty
                      ? null
                      : () async {
                          await widget.api.approve(id);
                          await _load();
                        },
                  child: const Text("Approve"),
                ),
              ),
            ),
          );
        }).toList(),
      ),
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
    if (mounted) {
      setState(() => _items = rows);
    }
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: _items.take(80).map((item) {
          return Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Card(
              elevation: 0,
              color: NovaTheme.surface.withValues(alpha: 0.72),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              child: ListTile(
                title: Text((item["title"] ?? "").toString()),
                subtitle: Text((item["content"] ?? "").toString(), style: TextStyle(color: Colors.white.withValues(alpha: 0.58))),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}
