import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../ondevice/framing.dart';
import '../ondevice/pipeline.dart';
import '../ondevice/segmentation_engine.dart';

/// "White background" -- the listing-photo flow.
///
/// Runs entirely on the phone: no backend, no API key, no per-image cost, and
/// it works with no signal. That matters for the actual job here, which is a
/// seller turning a pile of product shots into marketplace-legal listing
/// images, not a one-off creative edit.
class WhiteBackgroundScreen extends StatefulWidget {
  const WhiteBackgroundScreen({super.key});

  @override
  State<WhiteBackgroundScreen> createState() => _WhiteBackgroundScreenState();
}

class _WhiteBackgroundScreenState extends State<WhiteBackgroundScreen> {
  final _picker = ImagePicker();
  late final OnDevicePipeline _pipeline =
      OnDevicePipeline(MlKitSegmentationEngine());

  XFile? _source;
  Uint8List? _result;
  MarketplacePreset _preset = MarketplacePreset.amazon;
  PipelineStage? _stage;
  String? _error;

  @override
  void dispose() {
    _pipeline.dispose();
    super.dispose();
  }

  Future<void> _pick() async {
    final picked = await _picker.pickImage(
      source: ImageSource.gallery,
      // Keep the original resolution: the pipeline downscales internally to
      // its own working size, and cropping detail here would be irreversible.
      imageQuality: 100,
    );
    if (picked == null) return;
    setState(() {
      _source = picked;
      _result = null;
      _error = null;
    });
    await _process();
  }

  Future<void> _process() async {
    final source = _source;
    if (source == null) return;

    setState(() {
      _error = null;
      _stage = PipelineStage.decoding;
    });

    try {
      final bytes = await source.readAsBytes();
      final out = await _pipeline.run(
        imagePath: source.path,
        imageBytes: bytes,
        preset: _preset,
        onStage: (s) {
          if (mounted) setState(() => _stage = s);
        },
      );
      if (!mounted) return;
      setState(() {
        _result = out;
        _stage = null;
      });
    } on SegmentationUnavailable catch (e) {
      if (!mounted) return;
      setState(() {
        _stage = null;
        _error =
            "Couldn't run the on-device model: $e\n\nOn a fresh install Google "
            "Play Services downloads it the first time -- connect to Wi-Fi "
            "once, then try again.";
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _stage = null;
        _error = '$e';
      });
    }
  }

  Future<void> _save() async {
    final result = _result;
    if (result == null) return;
    final dir = await Directory.systemTemp.createTemp('listing');
    final name = '${_preset.name.toLowerCase().split(' ').first}_listing.jpg';
    final file = File('${dir.path}/$name');
    await file.writeAsBytes(result);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Saved to ${file.path}')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('White background'),
        actions: [
          if (_result != null)
            IconButton(
              onPressed: _save,
              icon: const Icon(Icons.save_alt),
              tooltip: 'Save',
            ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _PresetPicker(
              selected: _preset,
              enabled: _stage == null,
              onChanged: (p) {
                setState(() => _preset = p);
                if (_source != null) _process();
              },
            ),
            const SizedBox(height: 16),
            Expanded(child: _buildBody(context)),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _stage == null ? _pick : null,
              icon: const Icon(Icons.add_photo_alternate_outlined),
              label: Text(_source == null ? 'Pick a product photo' : 'Pick another'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBody(BuildContext context) {
    if (_stage != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const CircularProgressIndicator(),
            const SizedBox(height: 20),
            Text(_stageLabel(_stage!)),
            const SizedBox(height: 6),
            Text(
              'On your phone - nothing uploaded',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      );
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, size: 40),
            const SizedBox(height: 12),
            Text(_error!, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            OutlinedButton(onPressed: _process, child: const Text('Try again')),
          ],
        ),
      );
    }

    final result = _result;
    if (result == null) {
      return const _EmptyState();
    }

    return Column(
      children: [
        Expanded(
          child: ColoredBox(
            color: Colors.white,
            child: Image.memory(result, fit: BoxFit.contain),
          ),
        ),
        const SizedBox(height: 12),
        Text(
          '${_preset.name} - ${_preset.size}x${_preset.size}px, '
          'pure white, product at ${(_preset.fill * 100).round()}% of frame',
          style: Theme.of(context).textTheme.bodySmall,
          textAlign: TextAlign.center,
        ),
      ],
    );
  }

  String _stageLabel(PipelineStage stage) => switch (stage) {
        PipelineStage.decoding => 'Reading the photo...',
        PipelineStage.segmenting => 'Finding the product...',
        PipelineStage.refining => 'Cleaning up the edges...',
        PipelineStage.composing => 'Placing it on white...',
        PipelineStage.encoding => 'Saving...',
        PipelineStage.done => 'Done',
      };
}

class _PresetPicker extends StatelessWidget {
  const _PresetPicker({
    required this.selected,
    required this.onChanged,
    required this.enabled,
  });

  final MarketplacePreset selected;
  final ValueChanged<MarketplacePreset> onChanged;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      children: [
        for (final p in MarketplacePreset.all)
          ChoiceChip(
            label: Text(p.name),
            selected: p.name == selected.name,
            onSelected: enabled ? (_) => onChanged(p) : null,
          ),
      ],
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.auto_fix_high_outlined, size: 48),
          const SizedBox(height: 16),
          Text(
            'Marketplace-ready listing photos',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Text(
              'Cuts out your product and puts it on a pure white background, '
              'sized and framed for Amazon and Flipkart listings.\n\n'
              'Runs on your phone: free, works offline, and your photos never '
              'leave the device.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ),
        ],
      ),
    );
  }
}
