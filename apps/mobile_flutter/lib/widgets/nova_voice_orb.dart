import "dart:math" as math;
import "dart:typed_data";
import "dart:ui" show Vertices, VertexMode;

import "package:flutter/material.dart";
import "package:flutter/scheduler.dart";
import "package:vector_math/vector_math_64.dart" as vm;

/// Presets mirroring WebUI `AIVoiceOrb.DEFAULT_PRESETS`.
enum NovaVoiceOrbPreset { calm, thinking, speaking, excited }

/// Drives [NovaVoiceOrb] — match `NovaThreeSpeakingOrbHandle` / `AIVoiceOrb` control surface.
class NovaVoiceOrbController extends ChangeNotifier {
  NovaVoiceOrbController() {
    applyPreset(NovaVoiceOrbPreset.calm);
  }

  double targetSpeechLevel = 0.2;
  double targetSpeechPeak = 0.2;
  double rotationSpeed = 1.8;
  vm.Vector3 targetDirection = vm.Vector3(0.2, 1.0, 0.4);

  Color moodTargetA = const Color(0xFF39B9FF);
  Color moodTargetB = const Color(0xFF94F0FF);
  Color moodTargetShell = const Color(0xFF3DB8FF);
  Color moodTargetGlow = const Color(0xFF2EA8FF);

  void setSpeechLevel(double level) {
    final v = level.clamp(0.0, 1.0);
    setSpeechEnvelope(v, v);
  }

  void setSpeechEnvelope(double smooth, double peak) {
    targetSpeechLevel = smooth.clamp(0.0, 1.0);
    targetSpeechPeak = peak.clamp(0.0, 1.0);
    notifyListeners();
  }

  void setRotationSpeed(double speed) {
    rotationSpeed = math.max(0, speed);
    notifyListeners();
  }

  void setMoodPalette(Color colorA, Color colorB, Color shell, Color glow) {
    moodTargetA = colorA;
    moodTargetB = colorB;
    moodTargetShell = shell;
    moodTargetGlow = glow;
    notifyListeners();
  }

  void setBaseColor(Color c) {
    final hsl = HSLColor.fromColor(c);
    moodTargetA = c;
    moodTargetB = hsl.withHue((hsl.hue + 22) % 360).withSaturation((hsl.saturation + 0.08).clamp(0, 1)).withLightness((hsl.lightness + 0.22).clamp(0, 1)).toColor();
    moodTargetShell = Color.lerp(c, Colors.black, 0.45)!;
    moodTargetGlow = c;
    notifyListeners();
  }

  void randomizeDirection() {
    final r = math.Random();
    targetDirection = vm.Vector3(r.nextDouble() - 0.5, r.nextDouble() - 0.5, r.nextDouble() - 0.5);
    if (targetDirection.length2 > 1e-6) {
      targetDirection.normalize();
    } else {
      targetDirection.setValues(0.2, 1.0, 0.4);
    }
    if (r.nextBool()) {
      targetDirection.negate();
    }
    notifyListeners();
  }

  void applyPreset(NovaVoiceOrbPreset name) {
    switch (name) {
      case NovaVoiceOrbPreset.calm:
        targetSpeechLevel = 0;
        targetSpeechPeak = 0;
        rotationSpeed = 0.24;
        targetDirection = vm.Vector3(0.15, 1.0, 0.1);
      case NovaVoiceOrbPreset.thinking:
        targetSpeechLevel = 0.3;
        rotationSpeed = 0.7;
        targetDirection = vm.Vector3(0.45, 0.9, 0.2);
      case NovaVoiceOrbPreset.speaking:
        targetSpeechLevel = 0.72;
        rotationSpeed = 1.8;
        targetDirection = vm.Vector3(0.2, 1.0, 0.4);
      case NovaVoiceOrbPreset.excited:
        targetSpeechLevel = 0.96;
        rotationSpeed = 2.7;
        targetDirection = vm.Vector3(0.8, 0.4, 0.75);
    }
    targetSpeechPeak = targetSpeechLevel;
    notifyListeners();
  }
}

double _damp(double current, double target, double lambda, double dt) {
  return current + (target - current) * (1 - math.exp(-lambda * dt));
}

vm.Vector3 _lerpVec(vm.Vector3 a, vm.Vector3 b, double t) {
  return vm.Vector3(
    a.x + (b.x - a.x) * t,
    a.y + (b.y - a.y) * t,
    a.z + (b.z - a.z) * t,
  );
}

Color _lerpColor(Color a, Color b, double t) {
  return Color.lerp(a, b, t)!;
}

/// Stateful orb: runs the same tick loop as Web `AIVoiceOrb.animate()` (damp, mood lerp, axis rotation, breathing).
class NovaVoiceOrb extends StatefulWidget {
  const NovaVoiceOrb({
    super.key,
    this.controller,
    this.preset = NovaVoiceOrbPreset.calm,
    this.baseColor,
    this.size = 140,
  });

  final NovaVoiceOrbController? controller;
  final NovaVoiceOrbPreset preset;
  final Color? baseColor;
  final double size;

  @override
  State<NovaVoiceOrb> createState() => _NovaVoiceOrbState();
}

class _NovaVoiceOrbState extends State<NovaVoiceOrb> with SingleTickerProviderStateMixin {
  late Ticker _ticker;
  late NovaVoiceOrbController _ctrl;
  final _engine = _AivoiceOrbEngine();

  @override
  void initState() {
    super.initState();
    _ctrl = widget.controller ?? NovaVoiceOrbController();
    _ctrl.addListener(_onCtrl);
    _engine.applyPreset(widget.preset, _ctrl);
    if (widget.baseColor != null) {
      _ctrl.setBaseColor(widget.baseColor!);
    }
    _ticker = createTicker(_onTick)..start();
  }

  void _onCtrl() {
    _engine.syncTargets(_ctrl);
  }

  void _onTick(Duration elapsed) {
    _engine.tick(_ctrl, elapsed.inMicroseconds / 1e6);
    setState(() {});
  }

  @override
  void didUpdateWidget(covariant NovaVoiceOrb oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      _ctrl.removeListener(_onCtrl);
      _ctrl = widget.controller ?? NovaVoiceOrbController();
      _ctrl.addListener(_onCtrl);
    }
    if (oldWidget.preset != widget.preset) {
      _engine.applyPreset(widget.preset, _ctrl);
    }
    if (widget.baseColor != null) {
      _ctrl.setBaseColor(widget.baseColor!);
    }
  }

  @override
  void dispose() {
    _ticker.dispose();
    _ctrl.removeListener(_onCtrl);
    if (widget.controller == null) {
      _ctrl.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return RepaintBoundary(
      child: CustomPaint(
        size: Size(widget.size, widget.size),
        painter: _NovaOrbMeshPainter(engine: _engine, glowColor: _engine.moodGlow),
      ),
    );
  }
}

class _AivoiceOrbEngine {
  static const double radius = 1.85;
  final math.Random _rng = math.Random();
  double elapsed = 0;
  double uSpeak = 0;
  double uSpeakPeak = 0;
  vm.Vector3 rotationDirection = vm.Vector3(0.2, 1.0, 0.4);
  vm.Quaternion orientation = vm.Quaternion.identity();
  Color moodA = const Color(0xFF39B9FF);
  Color moodB = const Color(0xFF94F0FF);
  Color moodShell = const Color(0xFF3DB8FF);
  Color moodGlow = const Color(0xFF2EA8FF);
  double _calmWanderIn = 0;
  double _calmWanderNext = 6;

  void applyPreset(NovaVoiceOrbPreset p, NovaVoiceOrbController c) {
    c.applyPreset(p);
    syncTargets(c);
  }

  void syncTargets(NovaVoiceOrbController c) {
    // targets read each tick from c
  }

  void tick(NovaVoiceOrbController c, double dt) {
    if (dt <= 0 || dt > 0.25) {
      return;
    }
    elapsed += dt;
    uSpeak = _damp(uSpeak, c.targetSpeechLevel, 10, dt);
    uSpeakPeak = _damp(uSpeakPeak, c.targetSpeechPeak, 28, dt);

    final moodLerp = math.min(1.0, dt * 4.2);
    moodA = _lerpColor(moodA, c.moodTargetA, moodLerp);
    moodB = _lerpColor(moodB, c.moodTargetB, moodLerp);
    moodShell = _lerpColor(moodShell, c.moodTargetShell, moodLerp);
    moodGlow = _lerpColor(moodGlow, c.moodTargetGlow, moodLerp);

    rotationDirection = _lerpVec(rotationDirection, c.targetDirection, math.min(1.0, dt * 5));
    if (rotationDirection.length2 > 1e-8) {
      rotationDirection.normalize();
    }

    final act = math.max(c.targetSpeechLevel, c.targetSpeechPeak);
    if (act < 0.07) {
      _calmWanderIn += dt;
      if (_calmWanderIn >= _calmWanderNext) {
        _calmWanderIn = 0;
        _calmWanderNext = 6 + _rng.nextDouble() * 9;
        c.randomizeDirection();
        c.setRotationSpeed(0.16 + _rng.nextDouble() * 0.2);
      }
    } else {
      _calmWanderIn = 0;
    }

    final step = c.rotationSpeed * dt;
    final dq = vm.Quaternion.axisAngle(rotationDirection, step);
    orientation = (dq * orientation).normalized();

    // Keep quaternion numerically stable
    if (orientation.length2 < 1e-8) {
      orientation = vm.Quaternion.identity();
    }
  }

  double get breathing {
    final spk = math.max(uSpeak, uSpeakPeak * 0.85);
    final act = _NovaOrbMeshPainter._surfaceActivity(uSpeak, uSpeakPeak);
    final mag = 0.02 * (1 + spk * 2.2) * act + 0.0035 * (1 - act);
    return 1 + math.sin(elapsed * 1.7) * mag;
  }

  double get shellBreathingExtra => 1 + (breathing - 1) * 1.2;
}

/// Mesh sphere + the same displacement / colour formulas as `AIVoiceOrb.ts` shaders (core + shell).
class _NovaOrbMeshPainter extends CustomPainter {
  _NovaOrbMeshPainter({required this.engine, required this.glowColor});

  final _AivoiceOrbEngine engine;
  final Color glowColor;

  static List<int>? _triIndices;
  static List<vm.Vector3>? _baseUnit;

  static void _ensureMesh() {
    if (_triIndices != null) {
      return;
    }
    const lat = 28;
    const lon = 40;
    final verts = <vm.Vector3>[];
    for (var j = 0; j <= lat; j++) {
      final v = j / lat;
      final theta = v * math.pi;
      for (var i = 0; i <= lon; i++) {
        final u = i / lon;
        final phi = u * math.pi * 2;
        final x = math.sin(theta) * math.cos(phi);
        final y = math.cos(theta);
        final z = math.sin(theta) * math.sin(phi);
        verts.add(vm.Vector3(x, y, z));
      }
    }
    _baseUnit = verts;
    final idx = <int>[];
    for (var j = 0; j < lat; j++) {
      for (var i = 0; i < lon; i++) {
        final a = j * (lon + 1) + i;
        final b = a + lon + 1;
        idx.addAll([a, b, a + 1, b, b + 1, a + 1]);
      }
    }
    _triIndices = idx;
  }

  /// 0 = smooth sphere (no spikes), 1 = full WebUI displacement strength.
  static double _surfaceActivity(double uSpeak, double uSpeakPeak) {
    final m = math.max(uSpeak, uSpeakPeak);
    return _smoothstep(0.02, 0.13, m);
  }

  static vm.Vector3 _displaceCore(vm.Vector3 position, double uTime, double uSpeak, double uSpeakPeak) {
    final normal = position.normalized();
    final act = _surfaceActivity(uSpeak, uSpeakPeak);
    if (act < 1e-4) {
      return position;
    }
    final spk = uSpeak + (uSpeakPeak - uSpeak) * 0.78;
    final wave1 = math.sin(position.y * 5.0 + uTime * 1.8) * 0.06;
    final wave2 = math.sin(position.x * 7.5 - uTime * 2.4) * 0.05;
    final wave3 = math.sin((position.z + position.x) * 9.0 + uTime * 2.0) * 0.035;
    final pulse = (wave1 + wave2 + wave3) * (0.42 + uSpeak * 1.15 + uSpeakPeak * 1.85) * act;
    final spike = (math.sin(position.y * 16.0 + uTime * 11.0) * spk * 0.11 +
            math.sin(position.x * 14.0 - uTime * 9.0) * spk * 0.095 +
            math.sin((position.z * 1.7 + position.y) * 18.0 + uTime * 13.0) * spk * 0.072) *
        act;
    return position + normal * (pulse + spike);
  }

  static vm.Vector3 _displaceShell(vm.Vector3 position, double uTime, double uSpeak, double uSpeakPeak) {
    final normal = position.normalized();
    final act = _surfaceActivity(uSpeak, uSpeakPeak);
    final spk = uSpeak + (uSpeakPeak - uSpeak) * 0.65;
    final shellWave = math.sin(position.y * 3.0 + uTime * 1.2) * 0.08 * (1.0 + spk * 1.4) * act;
    return position + normal * (0.32 + shellWave);
  }

  static Color _coreFragment(vm.Vector3 vNormal, vm.Vector3 vPos, double uTime, double uSpeak, double uSpeakPeak, Color uA, Color uB) {
    final vn = vNormal.normalized();
    final act = _surfaceActivity(uSpeak, uSpeakPeak);
    final fresnel = math.pow(1.0 - (vn.z).abs(), 2.6).toDouble();
    var ribbons = math.sin((vPos.y + vPos.x) * 8.0 + uTime * 2.8) * 0.5 + 0.5;
    ribbons += math.sin((vPos.y - vPos.z) * 11.0 - uTime * 2.2) * 0.5 + 0.5;
    ribbons *= 0.5;
    final vib = (0.45 + uSpeak * 0.85 + uSpeakPeak * 1.05) * (0.28 + 0.72 * act);
    final alpha = _smoothstep(0.18, 1.0, ribbons) * (0.3 + fresnel * 0.95) * vib;
    final t = (ribbons + fresnel * 0.4).clamp(0.0, 1.0);
    final col = Color.lerp(uA, uB, t)!;
    return col.withValues(alpha: alpha.clamp(0.0, 1.0));
  }

  static Color _shellFragment(vm.Vector3 vNormal, double uTime, double uSpeak, double uSpeakPeak, Color shell) {
    final vn = vNormal.normalized();
    final act = _surfaceActivity(uSpeak, uSpeakPeak);
    final edge = math.pow(1.0 - (vn.z).abs(), 2.0).toDouble();
    final ripple = math.sin(vn.y * 9.0 + uTime * 2.0) * 0.5 + 0.5;
    final spk = uSpeak + (uSpeakPeak - uSpeak) * 0.55;
    final alpha = edge * (0.18 + ripple * 0.18) * (0.5 + spk * 1.15) * (0.22 + 0.78 * act);
    return shell.withValues(alpha: alpha.clamp(0.0, 1.0) * 0.85);
  }

  static double _smoothstep(double e0, double e1, double x) {
    final t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    return t * t * (3 - 2 * t);
  }

  @override
  void paint(Canvas canvas, Size size) {
    _ensureMesh();
    final base = _baseUnit!;
    final tri = _triIndices!;
    final uTime = engine.elapsed;
    final uSpeak = engine.uSpeak;
    final uSpeakPeak = engine.uSpeakPeak;
    final glowAct = 0.38 + 0.62 * _NovaOrbMeshPainter._surfaceActivity(uSpeak, uSpeakPeak);
    final aspect = size.width / math.max(size.height, 1.0);
    final near = 0.1;
    final far = 100.0;
    final f = 1.0 / math.tan(45 * math.pi / 360);
    final a = (far + near) / (near - far);
    final b = (2 * far * near) / (near - far);
    final projection = vm.Matrix4.zero()
      ..setEntry(0, 0, f / aspect)
      ..setEntry(1, 1, f)
      ..setEntry(2, 2, a)
      ..setEntry(2, 3, b)
      ..setEntry(3, 2, -1)
      ..setEntry(3, 3, 0);
    final view = vm.makeViewMatrix(vm.Vector3(0, 0, 8), vm.Vector3.zero(), vm.Vector3(0, 1, 0));
    final br = engine.breathing;
    final model = vm.Matrix4.compose(vm.Vector3.zero(), engine.orientation, vm.Vector3.all(br * _AivoiceOrbEngine.radius));
    final shellModel = vm.Matrix4.compose(vm.Vector3.zero(), engine.orientation, vm.Vector3.all(engine.shellBreathingExtra * _AivoiceOrbEngine.radius));
    final mvpCore = projection * view * model;
    final mvpShell = projection * view * shellModel;

    // Glow (sprite analogue)
    final c = Offset(size.width / 2, size.height / 2);
    final glowR = size.shortestSide * 0.52;
    final glowPaint = Paint()
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 20)
      ..shader = RadialGradient(
        colors: [
          glowColor.withValues(alpha: 0.55 * glowAct),
          glowColor.withValues(alpha: 0.12 * glowAct),
          Colors.transparent,
        ],
        stops: const [0.0, 0.35, 1.0],
      ).createShader(Rect.fromCircle(center: c, radius: glowR));
    canvas.drawCircle(c, glowR, glowPaint);

    void drawTris(vm.Matrix4 mvp, bool shell) {
      final pos2d = <Offset>[];
      for (var i = 0; i < base.length; i++) {
        final unit = base[i];
        final p0 = unit * _AivoiceOrbEngine.radius;
        final disp = shell ? _displaceShell(p0, uTime, uSpeak, uSpeakPeak) : _displaceCore(p0, uTime, uSpeak, uSpeakPeak);
        final clip = mvp * vm.Vector4(disp.x, disp.y, disp.z, 1.0);
        if (clip.w.abs() < 1e-8) {
          pos2d.add(Offset.zero);
          continue;
        }
        final ndcX = clip.x / clip.w;
        final ndcY = clip.y / clip.w;
        final x = (ndcX * 0.5 + 0.5) * size.width;
        final y = (1.0 - (ndcY * 0.5 + 0.5)) * size.height;
        pos2d.add(Offset(x, y));
      }

      final vtx = Float32List(tri.length * 2);
      final colors = Int32List(tri.length);
      for (var i = 0; i < tri.length; i += 3) {
        final ia = tri[i];
        final ib = tri[i + 1];
        final ic = tri[i + 2];
        final o = (i ~/ 3) * 6;
        vtx[o] = pos2d[ia].dx;
        vtx[o + 1] = pos2d[ia].dy;
        vtx[o + 2] = pos2d[ib].dx;
        vtx[o + 3] = pos2d[ib].dy;
        vtx[o + 4] = pos2d[ic].dx;
        vtx[o + 5] = pos2d[ic].dy;

        final ua = base[ia] * _AivoiceOrbEngine.radius;
        final ub = base[ib] * _AivoiceOrbEngine.radius;
        final uc = base[ic] * _AivoiceOrbEngine.radius;
        final na = ua.normalized();
        final nb = ub.normalized();
        final nc = uc.normalized();
        final da = shell ? _displaceShell(ua, uTime, uSpeak, uSpeakPeak) : _displaceCore(ua, uTime, uSpeak, uSpeakPeak);
        final db = shell ? _displaceShell(ub, uTime, uSpeak, uSpeakPeak) : _displaceCore(ub, uTime, uSpeak, uSpeakPeak);
        final dc = shell ? _displaceShell(uc, uTime, uSpeak, uSpeakPeak) : _displaceCore(uc, uTime, uSpeak, uSpeakPeak);
        if (shell) {
          colors[i] = _shellFragment(na, uTime, uSpeak, uSpeakPeak, engine.moodShell).toARGB32();
          colors[i + 1] = _shellFragment(nb, uTime, uSpeak, uSpeakPeak, engine.moodShell).toARGB32();
          colors[i + 2] = _shellFragment(nc, uTime, uSpeak, uSpeakPeak, engine.moodShell).toARGB32();
        } else {
          colors[i] = _coreFragment(na, da, uTime, uSpeak, uSpeakPeak, engine.moodA, engine.moodB).toARGB32();
          colors[i + 1] = _coreFragment(nb, db, uTime, uSpeak, uSpeakPeak, engine.moodA, engine.moodB).toARGB32();
          colors[i + 2] = _coreFragment(nc, dc, uTime, uSpeak, uSpeakPeak, engine.moodA, engine.moodB).toARGB32();
        }
      }

      final vertices = Vertices.raw(
        VertexMode.triangles,
        vtx,
        colors: colors,
      );
      final paint = Paint()..isAntiAlias = true;
      canvas.drawVertices(vertices, BlendMode.plus, paint);
    }

    drawTris(mvpShell, true);
    drawTris(mvpCore, false);
  }

  @override
  bool shouldRepaint(covariant _NovaOrbMeshPainter oldDelegate) => true;
}
