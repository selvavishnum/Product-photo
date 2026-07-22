import 'package:flutter/material.dart';

import 'screens/studio_screen.dart';

void main() {
  runApp(const ProductPhotoStudioApp());
}

class ProductPhotoStudioApp extends StatelessWidget {
  const ProductPhotoStudioApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Product Photo Studio',
      theme: ThemeData(
        colorSchemeSeed: Colors.deepPurple,
        useMaterial3: true,
        brightness: Brightness.dark,
      ),
      home: const StudioScreen(),
    );
  }
}
