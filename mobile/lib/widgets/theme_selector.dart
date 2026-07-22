import 'package:flutter/material.dart';

import '../models/studio_theme.dart';

class ThemeSelector extends StatelessWidget {
  const ThemeSelector({
    super.key,
    required this.themes,
    required this.selectedKey,
    required this.onSelected,
  });

  final List<StudioTheme> themes;
  final String? selectedKey;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    if (themes.isEmpty) {
      return const Text('Could not load theme presets -- use the prompt field below.');
    }
    return SizedBox(
      height: 48,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: themes.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final theme = themes[index];
          return ChoiceChip(
            label: Text(theme.label),
            selected: theme.key == selectedKey,
            onSelected: (_) => onSelected(theme.key),
          );
        },
      ),
    );
  }
}
