import 'package:flutter/material.dart';

import 'studio_screen.dart';
import 'white_background_screen.dart';

/// Grid/list of tools, matching Photoroom's "AI tools" tab shape.
///
/// Both destinations are pushed as full screens rather than switching tabs.
/// They used to jump to the Home tab, which broke once Home became the
/// White background flow -- every tile would have opened the same screen.
class AiToolsScreen extends StatelessWidget {
  const AiToolsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    void open(Widget screen) {
      Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => screen),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('AI tools')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _ToolTile(
            icon: Icons.storefront_outlined,
            title: 'White background',
            subtitle: 'Cut out your product, put it on white - free, offline',
            onTap: () => open(const WhiteBackgroundScreen()),
          ),
          _ToolTile(
            icon: Icons.landscape,
            title: 'AI Studio Backdrop',
            subtitle: 'Backdrop from a theme or prompt - paid, needs credit',
            onTap: () => open(const StudioScreen()),
          ),
          _ToolTile(
            icon: Icons.hd,
            title: 'AI Upscale',
            subtitle: 'Sharpen and enlarge - paid, needs credit',
            onTap: () => open(const StudioScreen()),
          ),
          _ToolTile(
            icon: Icons.tune,
            title: 'Edit Photo',
            subtitle: 'Crop, filters, tune, paint, text, stickers - free',
            onTap: () => open(const StudioScreen()),
          ),
          _ToolTile(
            icon: Icons.filter_drama,
            title: 'AI Shadows',
            subtitle: 'Drop shadow behind your product - free',
            onTap: () => open(const StudioScreen()),
          ),
          _ToolTile(
            icon: Icons.checkroom,
            title: 'AI Fashion Models',
            subtitle: 'Virtual try-on for clothing and jewellery - paid',
            onTap: () => open(const StudioScreen()),
          ),
        ],
      ),
    );
  }
}

class _ToolTile extends StatelessWidget {
  const _ToolTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: Icon(icon),
        title: Text(title),
        subtitle: Text(subtitle),
        trailing: const Icon(Icons.chevron_right),
        onTap: onTap,
      ),
    );
  }
}
