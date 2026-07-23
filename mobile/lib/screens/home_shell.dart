import 'package:flutter/material.dart';

import 'ai_tools_screen.dart';
import 'batch_screen.dart';
import 'content_screen.dart';
import 'studio_screen.dart';

/// Bottom-nav shell matching Photoroom's tab layout (Home / AI tools /
/// Batch / Content). Only Home (the studio flow) and AI tools (a menu into
/// that same flow) are real -- Batch and Content are honest placeholders,
/// see batch_screen.dart / content_screen.dart.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _selectedIndex = 0;

  void _goToStudio() => setState(() => _selectedIndex = 0);

  @override
  Widget build(BuildContext context) {
    final tabs = [
      const StudioScreen(),
      AiToolsScreen(onOpenStudio: _goToStudio),
      const BatchScreen(),
      const ContentScreen(),
    ];

    return Scaffold(
      // IndexedStack keeps every tab's state alive (e.g. an in-progress
      // studio flow survives switching to AI tools and back).
      body: IndexedStack(index: _selectedIndex, children: tabs),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selectedIndex,
        onDestinationSelected: (index) => setState(() => _selectedIndex = index),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home),
            label: 'Home',
          ),
          NavigationDestination(
            icon: Icon(Icons.auto_awesome_outlined),
            selectedIcon: Icon(Icons.auto_awesome),
            label: 'AI tools',
          ),
          NavigationDestination(
            icon: Icon(Icons.layers_outlined),
            selectedIcon: Icon(Icons.layers),
            label: 'Batch',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: 'Content',
          ),
        ],
      ),
    );
  }
}
