/// A studio backdrop preset, as returned by the backend's /ai/themes list.
class StudioTheme {
  const StudioTheme({required this.key, required this.label});

  final String key;
  final String label;

  static const Map<String, String> _labels = {
    'marble_table': 'Marble Table',
    'luxury_podium': 'Luxury Podium',
    'nature_sunlight': 'Nature Sunlight',
  };

  static StudioTheme fromKey(String key) {
    return StudioTheme(key: key, label: _labels[key] ?? key);
  }
}
