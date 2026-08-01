import 'package:flutter/material.dart';

import '../theme.dart';

/// The frame every question in the ad wizard sits in.
///
/// One question per screen. A shop owner filling this in between customers
/// can hold one decision in their head; a single long form is where people
/// give up halfway. More taps, and worth it.
///
/// Everything visual lives here so the questions stay a list of content and
/// the flow cannot drift screen by screen -- the same split as the web app's
/// step-shell.tsx, and for the same reason.
class StepShell extends StatelessWidget {
  const StepShell({
    super.key,
    required this.step,
    required this.total,
    required this.child,
    this.onBack,
  });

  final int step;
  final int total;
  final Widget child;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.chevron_left),
          onPressed: onBack,
          tooltip: 'Back',
        ),
        title: const Text(
          'Ad Auto-Pilot',
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
        ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(20),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
            // Segmented rather than one continuous bar: discrete marks read
            // as "this many left", which a percentage does not.
            child: Row(
              children: List.generate(total, (i) {
                return Expanded(
                  child: Container(
                    height: 4,
                    margin: EdgeInsets.only(right: i == total - 1 ? 0 : 6),
                    decoration: BoxDecoration(
                      color: i < step ? AppColors.ink : AppColors.line,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                );
              }),
            ),
          ),
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
          child: child,
        ),
      ),
    );
  }
}

class Question extends StatelessWidget {
  const Question({super.key, required this.title, this.tamil, this.hint});

  final String title;
  final String? tamil;
  final String? hint;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(
            fontSize: 28,
            fontWeight: FontWeight.w800,
            height: 1.2,
            letterSpacing: -0.5,
          ),
        ),
        if (tamil != null) ...[
          const SizedBox(height: 8),
          Text(
            tamil!,
            style: const TextStyle(
              fontSize: 18,
              color: AppColors.muted,
              height: 1.6,
            ),
          ),
        ],
        if (hint != null) ...[
          const SizedBox(height: 10),
          Text(
            hint!,
            style: const TextStyle(
              fontSize: 14,
              color: AppColors.muted,
              height: 1.6,
            ),
          ),
        ],
        const SizedBox(height: 24),
      ],
    );
  }
}

/// A radio row: label left, control right, the whole row tappable.
class Choice extends StatelessWidget {
  const Choice({
    super.key,
    required this.label,
    required this.selected,
    required this.onSelect,
    this.hint,
  });

  final String label;
  final String? hint;
  final bool selected;
  final VoidCallback onSelect;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        onTap: onSelect,
        borderRadius: BorderRadius.circular(18),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
          decoration: BoxDecoration(
            color: selected ? AppColors.surface : AppColors.page,
            border: Border.all(
              color: selected ? AppColors.ink : AppColors.line,
              width: selected ? 1.5 : 1,
            ),
            borderRadius: BorderRadius.circular(18),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if (hint != null && hint!.isNotEmpty)
                      Text(
                        hint!,
                        style: const TextStyle(
                          fontSize: 13,
                          color: AppColors.muted,
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: 16),
              Container(
                height: 24,
                width: 24,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: selected ? AppColors.ink : AppColors.line,
                    width: 2,
                  ),
                ),
                child: selected
                    ? Center(
                        child: Container(
                          height: 12,
                          width: 12,
                          decoration: const BoxDecoration(
                            shape: BoxShape.circle,
                            color: AppColors.ink,
                          ),
                        ),
                      )
                    : null,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
