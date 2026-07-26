import 'package:flutter/material.dart';

import 'studio_screen.dart';
import 'white_background_screen.dart';

/// Where a feature actually runs. This is the distinction that matters to
/// whoever is paying the bill, so it is on the card rather than buried in a
/// settings screen.
enum RunsOn {
  /// On the phone. No server, no signal needed, no marginal cost.
  device,

  /// Self-hosted GPU server. Free of per-image API fees, but the GPU itself
  /// is rented by the hour whether or not anyone uses it.
  gpuServer,
}

class DashboardFeature {
  const DashboardFeature({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.runsOn,
    required this.builder,
    this.available = true,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final RunsOn runsOn;
  final WidgetBuilder builder;

  /// False for features whose backend is not deployed yet -- shown, but
  /// honestly marked, rather than failing on tap.
  final bool available;
}

/// "E-Com Studio" home dashboard.
///
/// Five feature cards plus the on-device white-background flow. Cards are
/// tagged by where the work happens, because "Free" and "Paid" describe
/// billing rather than capability, and the useful question for this app is
/// whether a feature still works when the GPU box is switched off.
class MainDashboard extends StatelessWidget {
  const MainDashboard({super.key});

  static List<DashboardFeature> features() => [
        DashboardFeature(
          icon: Icons.storefront_outlined,
          title: 'White Background',
          subtitle: 'Cutout + marketplace framing for Amazon and Flipkart',
          runsOn: RunsOn.device,
          builder: (_) => const WhiteBackgroundScreen(),
        ),
        DashboardFeature(
          icon: Icons.landscape_outlined,
          title: 'AI Studio Backdrop',
          subtitle: 'Marble, wooden shelf or minimalist studio from a prompt',
          runsOn: RunsOn.gpuServer,
          builder: (_) => const StudioScreen(),
        ),
        DashboardFeature(
          icon: Icons.hd_outlined,
          title: 'AI Upscale',
          subtitle: 'Sharpen and enlarge to HD/4K for cataloguing',
          runsOn: RunsOn.gpuServer,
          builder: (_) => const StudioScreen(),
        ),
        DashboardFeature(
          icon: Icons.tune,
          title: 'Edit Photo',
          subtitle: 'Crop, tune, filters, text, stickers, paint',
          runsOn: RunsOn.device,
          builder: (_) => const StudioScreen(),
        ),
        DashboardFeature(
          icon: Icons.filter_drama_outlined,
          title: 'AI Shadows',
          subtitle: 'Soft directional shadow under your product',
          runsOn: RunsOn.device,
          builder: (_) => const StudioScreen(),
        ),
        DashboardFeature(
          icon: Icons.checkroom_outlined,
          title: 'AI Fashion Models',
          subtitle: 'Put clothing or jewellery on a real human model',
          runsOn: RunsOn.gpuServer,
          builder: (_) => const StudioScreen(),
        ),
      ];

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final items = features();

    return Scaffold(
      body: SafeArea(
        child: CustomScrollView(
          slivers: [
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 24, 20, 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'E-Com Studio',
                      style: theme.textTheme.headlineMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Product photos ready to list',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              sliver: SliverGrid(
                gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                  // Max extent rather than a fixed column count, so the grid
                  // reflows sensibly on tablets and landscape instead of
                  // stretching two cards across the screen.
                  maxCrossAxisExtent: 260,
                  mainAxisSpacing: 12,
                  crossAxisSpacing: 12,
                  childAspectRatio: 0.92,
                ),
                delegate: SliverChildBuilderDelegate(
                  (context, i) => _FeatureCard(feature: items[i]),
                  childCount: items.length,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FeatureCard extends StatelessWidget {
  const _FeatureCard({required this.feature});

  final DashboardFeature feature;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Card(
      clipBehavior: Clip.antiAlias,
      color: scheme.surfaceContainerHighest,
      child: InkWell(
        onTap: feature.available
            ? () => Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: feature.builder),
                )
            : () => ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('This one needs the GPU server running.'),
                  ),
                ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: scheme.primaryContainer,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(feature.icon, color: scheme.onPrimaryContainer),
              ),
              const Spacer(),
              Text(
                feature.title,
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w600,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 4),
              Text(
                feature.subtitle,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 10),
              _RunsOnTag(runsOn: feature.runsOn),
            ],
          ),
        ),
      ),
    );
  }
}

class _RunsOnTag extends StatelessWidget {
  const _RunsOnTag({required this.runsOn});

  final RunsOn runsOn;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final onDevice = runsOn == RunsOn.device;

    final bg = onDevice ? scheme.tertiaryContainer : scheme.secondaryContainer;
    final fg = onDevice ? scheme.onTertiaryContainer : scheme.onSecondaryContainer;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            onDevice ? Icons.phone_android : Icons.dns_outlined,
            size: 12,
            color: fg,
          ),
          const SizedBox(width: 4),
          Text(
            onDevice ? 'Free - on device' : 'Needs GPU server',
            style: Theme.of(context)
                .textTheme
                .labelSmall
                ?.copyWith(color: fg, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}
