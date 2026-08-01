import 'dart:io';

import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../../services/adpilot_api.dart';
import '../../theme.dart';
import '../../widgets/passcode_field.dart';

/// What the shop can do with a finished ad, cheapest first.
///
///  1. **Share it.** Works immediately -- no account, no token, no approval,
///     no money. This is the one most owners will actually use, so it leads.
///  2. **Post it to Instagram.** Free, but it publishes publicly under the
///     owner's name, so it needs the passcode.
///  3. **Run it as a paid ad.** Costs money, lands paused.
///
/// The order is the point. Offering the slowest, most expensive option first
/// is how a tool ends up unused.
class AdResultScreen extends StatefulWidget {
  const AdResultScreen({
    super.key,
    required this.api,
    required this.plan,
    required this.businessName,
    required this.language,
    required this.image,
  });

  final AdPilotApi api;
  final AdPlan plan;
  final String businessName;
  final String language;
  final File? image;

  @override
  State<AdResultScreen> createState() => _AdResultScreenState();
}

class _AdResultScreenState extends State<AdResultScreen> {
  String _passcode = '';
  bool _posting = false;
  bool _publishing = false;
  String? _postError;
  String? _publishError;
  InstagramPost? _posted;
  PublishResult? _published;

  AdCopy get _preferred => widget.plan.preferred(widget.language);

  Future<void> _share() async {
    final copy = _preferred;
    try {
      await SharePlus.instance.share(
        ShareParams(
          text: copy.shareText,
          // The photo goes with the words when there is one: an ad without
          // its picture is half an ad, and re-attaching it by hand in
          // WhatsApp is exactly the friction this removes.
          files: widget.image == null ? null : [XFile(widget.image!.path)],
        ),
      );
    } catch (_) {
      // Dismissing the sheet is the user changing their mind, not a failure,
      // and must not surface as one.
    }
  }

  Future<void> _postToInstagram() async {
    final image = widget.image;
    if (image == null) return;
    setState(() {
      _posting = true;
      _postError = null;
    });
    try {
      widget.api.passcode = _passcode;
      final result =
          await widget.api.postToInstagram(copy: _preferred, image: image);
      if (mounted) setState(() => _posted = result);
    } on ApiException catch (err) {
      if (mounted) setState(() => _postError = err.message);
    } catch (_) {
      if (mounted) setState(() => _postError = 'Could not reach the server.');
    } finally {
      if (mounted) setState(() => _posting = false);
    }
  }

  Future<void> _publish() async {
    final image = widget.image;
    if (image == null) return;
    setState(() {
      _publishing = true;
      _publishError = null;
    });
    try {
      widget.api.passcode = _passcode;
      final result = await widget.api.publishCampaign(
        plan: widget.plan,
        businessName: widget.businessName,
        language: widget.language,
        image: image,
      );
      if (mounted) setState(() => _published = result);
    } on ApiException catch (err) {
      if (mounted) {
        setState(() => _publishError = err.isPolicy
            // Meta's own wording about what to change, shown as-is: replacing
            // it with something generic removes the only actionable part.
            ? 'Facebook rejected this ad: ${err.message}'
            : err.message);
      }
    } catch (_) {
      if (mounted) setState(() => _publishError = 'Could not reach the server.');
    } finally {
      if (mounted) setState(() => _publishing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.plan.targeting;

    return Scaffold(
      appBar: AppBar(title: const Text('Your ad is ready')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 40),
        children: [
          const Text(
            'உங்கள் விளம்பரம் தயார்',
            style: TextStyle(fontSize: 18, color: AppColors.muted),
          ),
          const SizedBox(height: 20),

          for (final copy in widget.plan.copies) _CopyCard(copy: copy),

          const SizedBox(height: 28),
          _sectionTitle('Send it to your customers'),
          const Text(
            'WhatsApp, Instagram, your customer group — free, right now.',
            style: TextStyle(fontSize: 14, color: AppColors.muted),
          ),
          const SizedBox(height: 14),
          PrimaryButton(
            label: 'Share this ad',
            showArrow: false,
            onPressed: _share,
          ),

          const SizedBox(height: 36),
          _sectionTitle('Post it to Instagram'),
          const Text(
            "Goes straight to your shop's feed. Free — this is not a paid ad.",
            style: TextStyle(fontSize: 14, color: AppColors.muted),
          ),
          const SizedBox(height: 14),
          if (_posted != null)
            Note.success(
              _posted!.permalink == null
                  ? 'Posted to your Instagram feed.'
                  : 'Posted to your Instagram feed.\n${_posted!.permalink}',
            )
          else ...[
            if (widget.image == null)
              const Note.warning(
                'Instagram needs a photo. Start again and add one.',
              ),
            if (_postError != null) Note.warning(_postError!),
            if (widget.image != null) ...[
              PasscodeField(
                value: _passcode,
                onChanged: (v) => setState(() => _passcode = v),
              ),
              const SizedBox(height: 12),
              SecondaryButton(
                label: _posting ? 'Posting…' : 'Post to Instagram',
                busy: _posting,
                onPressed: _passcode.isEmpty ? null : _postToInstagram,
              ),
            ],
          ],

          const SizedBox(height: 36),
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(20),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Who a paid ad would reach',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 12),
                _row('Age', '${t.ageMin}–${t.ageMax}'),
                _row('Area',
                    '${t.locationName} · ${t.locationRadiusKm} km around you'),
                _row('Budget', '₹${widget.plan.dailyBudgetInr} per day'),
                const SizedBox(height: 12),
                Text(
                  t.rationale,
                  style: const TextStyle(
                    fontSize: 14,
                    color: AppColors.muted,
                    height: 1.6,
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 20),
          if (_published != null)
            Note.success(
              '${_published!.note}'
              '${_published!.matchedLocation == null ? '' : '\n\nMeta matched your area to ${_published!.matchedLocation}.'}',
            )
          else ...[
            _sectionTitle('Or run it as a paid ad'),
            const Text(
              'This creates the campaign on Facebook and leaves it paused. '
              'Nothing spends until you switch it on yourself.',
              style: TextStyle(fontSize: 14, color: AppColors.muted),
            ),
            const SizedBox(height: 14),
            if (widget.image == null)
              const Note.warning(
                'Facebook needs a photo for a paid ad. Start again and add one.',
              )
            else ...[
              if (_publishError != null) ...[
                Note.warning(_publishError!),
                const SizedBox(height: 12),
              ],
              if (_posted == null)
                const Text(
                  'Uses the same owner passcode as above.',
                  style: TextStyle(fontSize: 12, color: AppColors.faint),
                )
              else
                PasscodeField(
                  value: _passcode,
                  onChanged: (v) => setState(() => _passcode = v),
                ),
              const SizedBox(height: 12),
              SecondaryButton(
                label: _publishing ? 'Sending to Facebook…' : 'Send to Facebook',
                busy: _publishing,
                onPressed: _passcode.isEmpty ? null : _publish,
              ),
            ],
          ],

          const SizedBox(height: 32),
          SecondaryButton(
            label: 'Make another ad',
            onPressed: () => Navigator.of(context).pop(),
          ),
        ],
      ),
    );
  }

  Widget _sectionTitle(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 4),
        child: Text(
          text,
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
        ),
      );

  Widget _row(String label, String value) => Padding(
        padding: const EdgeInsets.only(bottom: 4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 72,
              child: Text(
                label,
                style: const TextStyle(fontSize: 14, color: AppColors.muted),
              ),
            ),
            Expanded(child: Text(value, style: const TextStyle(fontSize: 14))),
          ],
        ),
      );
}

class _CopyCard extends StatelessWidget {
  const _CopyCard({required this.copy});

  final AdCopy copy;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            copy.language,
            style: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: AppColors.faint,
              letterSpacing: 0.8,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            copy.headline,
            style: const TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.w700,
              height: 1.35,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            copy.primaryText,
            style: const TextStyle(fontSize: 15, height: 1.7),
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            decoration: BoxDecoration(
              color: AppColors.ink,
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              copy.cta,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 13,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
