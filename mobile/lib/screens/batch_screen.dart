import 'package:flutter/material.dart';

import '../widgets/coming_soon.dart';

/// Placeholder for batch (multi-image) processing -- a real, separate
/// feature (queueing/processing many images against the backend) that
/// isn't built yet. Not faked as a working button.
class BatchScreen extends StatelessWidget {
  const BatchScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Batch')),
      body: const ComingSoon(
        icon: Icons.layers_outlined,
        title: 'Batch editing',
        message: 'Process multiple product photos at once -- coming soon.',
      ),
    );
  }
}
