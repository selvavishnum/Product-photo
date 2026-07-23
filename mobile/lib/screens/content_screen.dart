import 'package:flutter/material.dart';

import '../widgets/coming_soon.dart';

/// Placeholder for account sign-in and a saved-designs library -- needs
/// Firebase Auth + Cloud Storage, neither of which is built yet. Not faked
/// as a working sign-in screen.
class ContentScreen extends StatelessWidget {
  const ContentScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Content')),
      body: const ComingSoon(
        icon: Icons.person_outline,
        title: 'Sign in & your library',
        message: 'Account sign-in and saved designs -- coming soon.',
      ),
    );
  }
}
