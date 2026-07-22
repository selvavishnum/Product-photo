import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../models/studio_theme.dart';
import '../services/api_service.dart';
import '../widgets/theme_selector.dart';

enum _Stage { picking, removingBackground, readyForBackdrop, generating, done, error }

class StudioScreen extends StatefulWidget {
  const StudioScreen({super.key});

  @override
  State<StudioScreen> createState() => _StudioScreenState();
}

class _StudioScreenState extends State<StudioScreen> {
  final ApiService _api = ApiService();
  final ImagePicker _picker = ImagePicker();
  final TextEditingController _promptController = TextEditingController();

  _Stage _stage = _Stage.picking;
  Uint8List? _cutoutBytes;
  Uint8List? _resultBytes;
  List<StudioTheme> _themes = [];
  String? _selectedThemeKey;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _loadThemes();
  }

  @override
  void dispose() {
    _promptController.dispose();
    super.dispose();
  }

  Future<void> _loadThemes() async {
    try {
      final keys = await _api.fetchThemes();
      if (!mounted) return;
      setState(() => _themes = keys.map(StudioTheme.fromKey).toList());
    } catch (_) {
      // Non-fatal -- the custom prompt field still works without presets.
    }
  }

  Future<void> _pickAndRemoveBackground() async {
    final picked = await _picker.pickImage(source: ImageSource.gallery);
    if (picked == null) return;

    setState(() {
      _stage = _Stage.removingBackground;
      _errorMessage = null;
    });

    try {
      final cutout = await _api.removeBackground(File(picked.path));
      setState(() {
        _cutoutBytes = cutout;
        _stage = _Stage.readyForBackdrop;
      });
    } catch (e) {
      setState(() {
        _errorMessage = e.toString();
        _stage = _Stage.error;
      });
    }
  }

  Future<void> _generateBackdrop() async {
    final cutout = _cutoutBytes;
    if (cutout == null) return;

    final customPrompt = _promptController.text.trim();

    setState(() {
      _stage = _Stage.generating;
      _errorMessage = null;
    });

    try {
      final result = await _api.generateBackground(
        cutoutBytes: cutout,
        themeKey: customPrompt.isEmpty ? _selectedThemeKey : null,
        customPrompt: customPrompt.isEmpty ? null : customPrompt,
      );
      setState(() {
        _resultBytes = result;
        _stage = _Stage.done;
      });
    } catch (e) {
      setState(() {
        _errorMessage = e.toString();
        _stage = _Stage.error;
      });
    }
  }

  void _reset() {
    setState(() {
      _stage = _Stage.picking;
      _cutoutBytes = null;
      _resultBytes = null;
      _selectedThemeKey = null;
      _errorMessage = null;
      _promptController.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Product Photo Studio')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: _buildBody(),
      ),
    );
  }

  Widget _buildBody() {
    switch (_stage) {
      case _Stage.picking:
        return Center(
          child: ElevatedButton.icon(
            onPressed: _pickAndRemoveBackground,
            icon: const Icon(Icons.add_photo_alternate),
            label: const Text('Pick a product photo'),
          ),
        );

      case _Stage.removingBackground:
        return const Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              CircularProgressIndicator(),
              SizedBox(height: 12),
              Text('Removing background...'),
            ],
          ),
        );

      case _Stage.readyForBackdrop:
      case _Stage.generating:
        return SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _PreviewImage(bytes: _resultBytes ?? _cutoutBytes),
              const SizedBox(height: 16),
              const Text('Choose a studio theme', style: TextStyle(fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              ThemeSelector(
                themes: _themes,
                selectedKey: _selectedThemeKey,
                onSelected: (key) => setState(() {
                  _selectedThemeKey = key;
                  _promptController.clear();
                }),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _promptController,
                decoration: const InputDecoration(
                  labelText: 'Or describe your own backdrop',
                  border: OutlineInputBorder(),
                ),
                onChanged: (_) => setState(() => _selectedThemeKey = null),
              ),
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: _stage == _Stage.generating ? null : _generateBackdrop,
                child: _stage == _Stage.generating
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Generate Studio Shot'),
              ),
              TextButton(onPressed: _reset, child: const Text('Start over')),
            ],
          ),
        );

      case _Stage.done:
        return SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _PreviewImage(bytes: _resultBytes),
              const SizedBox(height: 16),
              ElevatedButton(onPressed: _reset, child: const Text('Start over')),
            ],
          ),
        );

      case _Stage.error:
        return Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_errorMessage ?? 'Something went wrong', textAlign: TextAlign.center),
              const SizedBox(height: 12),
              ElevatedButton(onPressed: _reset, child: const Text('Try again')),
            ],
          ),
        );
    }
  }
}

class _PreviewImage extends StatelessWidget {
  const _PreviewImage({required this.bytes});

  final Uint8List? bytes;

  @override
  Widget build(BuildContext context) {
    final imageBytes = bytes;
    if (imageBytes == null) return const SizedBox.shrink();
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: Image.memory(imageBytes, height: 320, fit: BoxFit.contain),
    );
  }
}
