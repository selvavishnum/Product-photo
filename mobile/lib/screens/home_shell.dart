import 'package:flutter/material.dart';

import 'ads/ad_wizard_screen.dart';
import 'ads/daily_posts_screen.dart';
import 'ai_tools_screen.dart';
import 'white_background_screen.dart';

/// Bottom-nav shell.
///
/// Four tabs, in the order a shop owner actually reaches for them:
///
///  - **Photo** — the on-device studio flow. Free, works offline, and keeps
///    working when the paid backend does not, so it leads.
///  - **Tools** — the rest of the photo features.
///  - **Ads** — write an ad, then share it, post it, or promote it.
///  - **Daily** — posts written overnight, waiting for a tap.
///
/// Ads and Daily took the slots Batch and Content held. Both of those were
/// honest "coming soon" placeholders that had never been built, so swapping
/// them for working features loses nothing.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _selectedIndex = 0;

  @override
  Widget build(BuildContext context) {
    final tabs = [
      const WhiteBackgroundScreen(),
      const AiToolsScreen(),
      const AdWizardScreen(),
      const DailyPostsScreen(),
    ];

    return Scaffold(
      // IndexedStack keeps every tab's state alive -- a half-finished ad
      // survives a glance at the photo tools and back, which an owner
      // interrupted by a customer will do constantly.
      body: IndexedStack(index: _selectedIndex, children: tabs),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selectedIndex,
        onDestinationSelected: (index) => setState(() => _selectedIndex = index),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.auto_fix_high_outlined),
            selectedIcon: Icon(Icons.auto_fix_high),
            label: 'Photo',
          ),
          NavigationDestination(
            icon: Icon(Icons.auto_awesome_outlined),
            selectedIcon: Icon(Icons.auto_awesome),
            label: 'Tools',
          ),
          NavigationDestination(
            icon: Icon(Icons.campaign_outlined),
            selectedIcon: Icon(Icons.campaign),
            label: 'Ads',
          ),
          NavigationDestination(
            icon: Icon(Icons.calendar_today_outlined),
            selectedIcon: Icon(Icons.calendar_today),
            label: 'Daily',
          ),
        ],
      ),
    );
  }
}
