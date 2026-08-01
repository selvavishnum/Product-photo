import 'package:flutter/material.dart';

import 'screens/home_shell.dart';
import 'theme.dart';

void main() {
  runApp(const ProductPhotoStudioApp());
}

class ProductPhotoStudioApp extends StatelessWidget {
  const ProductPhotoStudioApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Product Photo Studio',
      // Light and near-monochrome, matching the web app so the two do not
      // read as different products. See lib/theme.dart for the reasoning.
      theme: buildAppTheme(),
      home: const HomeShell(),
    );
  }
}
