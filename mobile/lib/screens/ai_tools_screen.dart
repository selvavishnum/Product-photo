import 'package:flutter/material.dart';

/// Grid/list of AI tools, matching Photoroom's "AI tools" tab shape.
/// Tapping an available tool switches back to the Home tab, since they're
/// all steps of the one studio flow there -- not separate implementations.
/// The two disabled tiles are honest about what isn't built yet.
class AiToolsScreen extends StatelessWidget {
  const AiToolsScreen({super.key, required this.onOpenStudio});

  final VoidCallback onOpenStudio;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('AI tools')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _ToolTile(
            icon: Icons.cut,
            title: 'Background Remover',
            subtitle: 'Cut out your product',
            onTap: onOpenStudio,
          ),
          _ToolTile(
            icon: Icons.landscape,
            title: 'AI Studio Backdrop',
            subtitle: 'Generate a studio background from a theme or prompt',
            onTap: onOpenStudio,
          ),
          _ToolTile(
            icon: Icons.hd,
            title: 'AI Upscale',
            subtitle: 'Sharpen and enlarge (paid)',
            onTap: onOpenStudio,
          ),
          _ToolTile(
            icon: Icons.tune,
            title: 'Edit Photo',
            subtitle: 'Crop, filters, tune, paint, text, stickers',
            onTap: onOpenStudio,
          ),
          const Divider(height: 32),
          const _ToolTile(
            icon: Icons.wb_shade_outlined,
            title: 'AI Shadows',
            subtitle: 'Realistic drop shadows on generated surfaces -- coming soon',
          ),
          const _ToolTile(
            icon: Icons.checkroom_outlined,
            title: 'AI Fashion Models',
            subtitle: 'Virtual try-on for clothing and jewelry -- coming soon',
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
    this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final available = onTap != null;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: Icon(icon),
        title: Text(title),
        subtitle: Text(subtitle),
        enabled: available,
        trailing: available ? const Icon(Icons.chevron_right) : null,
        onTap: onTap,
      ),
    );
  }
}
