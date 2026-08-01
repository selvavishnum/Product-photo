import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:image_picker/image_picker.dart';

import '../../services/adpilot_api.dart';
import '../../theme.dart';
import '../../widgets/passcode_field.dart';
import '../../widgets/step_shell.dart';

/// The daily post queue.
///
/// A post is written for the shop overnight and waits here. The owner reads
/// it and taps once, or skips it. That tap is the whole safeguard: a feed of
/// unreviewed AI posts is a slow way to lose reach on a business account, and
/// ten seconds a day is a cheap way not to.
///
/// Also where the shop profile is set, because the generator needs something
/// to write about when nobody is present to ask.
class DailyPostsScreen extends StatefulWidget {
  const DailyPostsScreen({super.key, this.api});

  final AdPilotApi? api;

  @override
  State<DailyPostsScreen> createState() => _DailyPostsScreenState();
}

class _DailyPostsScreenState extends State<DailyPostsScreen> {
  /// The passcode authorises real spending, so it goes in the platform
  /// keystore rather than SharedPreferences, which is readable on a rooted
  /// device.
  static const _storage = FlutterSecureStorage();
  static const _passcodeKey = 'owner_passcode';

  static const _languages = ['TAMIL', 'TANGLISH', 'ENGLISH'];

  /// Shown in the script the option refers to, so the Tamil option is
  /// recognisable to someone who reads Tamil more comfortably than English.
  static String _languageLabel(String code) => switch (code) {
        'TAMIL' => 'தமிழ்',
        'TANGLISH' => 'Tanglish',
        _ => 'English',
      };

  late final AdPilotApi _api = widget.api ?? AdPilotApi();

  String _passcode = '';
  bool _unlocked = false;
  bool _loading = false;
  String? _error;
  String? _busyId;

  QueueState? _queue;

  final _businessName = TextEditingController();
  final _category = TextEditingController();
  final _description = TextEditingController();
  final _city = TextEditingController();
  String _language = 'TAMIL';
  File? _image;

  @override
  void initState() {
    super.initState();
    _restorePasscode();
  }

  @override
  void dispose() {
    _businessName.dispose();
    _category.dispose();
    _description.dispose();
    _city.dispose();
    super.dispose();
  }

  Future<void> _restorePasscode() async {
    // Remembered so the queue is a daily habit, not a daily password prompt.
    final saved = await _storage.read(key: _passcodeKey);
    if (saved == null || saved.isEmpty || !mounted) return;
    setState(() => _passcode = saved);
    await _load(unlockOnSuccess: true);
  }

  Future<void> _load({bool unlockOnSuccess = false}) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      _api.passcode = _passcode;
      final state = await _api.loadQueue();
      if (!mounted) return;
      setState(() {
        _queue = state;
        if (unlockOnSuccess) _unlocked = true;
      });
      final profile = state.profile;
      if (profile != null) {
        _businessName.text = profile.businessName;
        _category.text = profile.category;
        _description.text = profile.description;
        _city.text = profile.city ?? '';
        _language = profile.language;
      }
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not reach the server.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _unlock() async {
    await _load(unlockOnSuccess: true);
    if (_unlocked) await _storage.write(key: _passcodeKey, value: _passcode);
  }

  Future<void> _pickImage() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery);
    if (picked != null) setState(() => _image = File(picked.path));
  }

  Future<void> _saveProfile() async {
    setState(() {
      _busyId = 'profile';
      _error = null;
    });
    try {
      _api.passcode = _passcode;
      await _api.saveShopProfile(
        businessName: _businessName.text.trim(),
        category: _category.text.trim(),
        description: _description.text.trim(),
        city: _city.text.trim(),
        language: _language,
        image: _image,
      );
      await _load();
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  Future<void> _act(QueuedPost post, {required bool approve}) async {
    setState(() {
      _busyId = post.id;
      _error = null;
    });
    try {
      _api.passcode = _passcode;
      await _api.actOnPost(post.id, approve: approve);
      await _load();
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_unlocked) return _lockScreen();

    final queue = _queue;
    return Scaffold(
      appBar: AppBar(title: const Text('Daily posts')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 40),
          children: [
            Text(
              queue?.autoPost == true
                  ? 'Posting automatically each day.'
                  : 'One post a day, waiting for your tap.',
              style: const TextStyle(fontSize: 15, color: AppColors.muted),
            ),
            const SizedBox(height: 20),
            if (_error != null) ...[
              Note.warning(_error!),
              const SizedBox(height: 20),
            ],
            if (queue != null) ...[
              if (queue.pending.isEmpty)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(vertical: 28),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const Text(
                    'Nothing waiting.\nThe next post is written overnight.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: AppColors.muted, height: 1.7),
                  ),
                )
              else ...[
                const Text(
                  'Waiting for you',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 12),
                for (final post in queue.pending) _pendingCard(post),
              ],
              const SizedBox(height: 32),
              _profileSection(queue),
              if (queue.history.isNotEmpty) ...[
                const SizedBox(height: 32),
                const Text(
                  'Earlier',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 12),
                for (final post in queue.history) _historyRow(post),
              ],
            ] else if (_loading)
              const Center(child: CircularProgressIndicator()),
          ],
        ),
      ),
    );
  }

  Widget _lockScreen() {
    return Scaffold(
      appBar: AppBar(title: const Text('Daily posts')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 24, 20, 40),
        children: [
          const Text(
            'தினசரி பதிவுகள்',
            style: TextStyle(fontSize: 18, color: AppColors.muted),
          ),
          const SizedBox(height: 24),
          PasscodeField(
            value: _passcode,
            showHint: false,
            onChanged: (v) => setState(() => _passcode = v),
          ),
          if (_error != null) ...[
            const SizedBox(height: 16),
            Note.warning(_error!),
          ],
          const SizedBox(height: 20),
          PrimaryButton(
            label: 'Open',
            showArrow: false,
            busy: _loading,
            onPressed: _passcode.isEmpty ? null : _unlock,
          ),
        ],
      ),
    );
  }

  Widget _pendingCard(QueuedPost post) {
    final busy = _busyId == post.id;
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
          if (post.imageUrl != null) ...[
            ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: Image.network(
                post.imageUrl!,
                width: double.infinity,
                fit: BoxFit.cover,
                // A broken image must not take the card -- and the words are
                // the part being reviewed.
                errorBuilder: (_, __, ___) => const SizedBox.shrink(),
              ),
            ),
            const SizedBox(height: 16),
          ],
          Text(
            post.headline,
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w700,
              height: 1.35,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            post.primaryText,
            style: const TextStyle(fontSize: 15, height: 1.7),
          ),
          const SizedBox(height: 10),
          Text(
            post.cta,
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 20),
          Row(
            children: [
              Expanded(
                child: PrimaryButton(
                  label: busy ? 'Posting…' : 'Post it',
                  showArrow: false,
                  busy: busy,
                  onPressed: () => _act(post, approve: true),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: SecondaryButton(
                  label: 'Skip',
                  onPressed: busy ? null : () => _act(post, approve: false),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _profileSection(QueueState queue) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'What to write about',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 4),
          const Text(
            'Saved once. Every daily post is written from this.',
            style: TextStyle(fontSize: 14, color: AppColors.muted),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _businessName,
            decoration: appInput('Shop name'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _category,
            decoration: appInput('What you sell'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _description,
            maxLines: 4,
            onChanged: (_) => setState(() {}),
            decoration: appInput('Tell us about the shop — what you sell, who buys it, '
                  'what makes it worth visiting.'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _city,
            decoration: appInput('Town'),
          ),
          const SizedBox(height: 16),
          // Deliberately the same Choice rows as the wizard rather than a
          // dropdown: three options are quicker to tap than to open, and it
          // keeps one selection control across the whole app.
          for (final l in _languages)
            Choice(
              label: _languageLabel(l),
              selected: _language == l,
              onSelect: () => setState(() => _language = l),
            ),
          const SizedBox(height: 4),
          SecondaryButton(
            label: _image == null ? 'Choose a photo' : 'Photo chosen',
            onPressed: _pickImage,
          ),
          const SizedBox(height: 6),
          Text(
            queue.profile?.imageUrl != null
                ? 'A photo is saved. Choose another to replace it.'
                : 'Instagram needs a photo. JPEG or PNG.',
            style: const TextStyle(fontSize: 12, color: AppColors.faint),
          ),
          const SizedBox(height: 20),
          PrimaryButton(
            label: 'Save',
            showArrow: false,
            busy: _busyId == 'profile',
            onPressed: _description.text.trim().length < 10 ? null : _saveProfile,
          ),
        ],
      ),
    );
  }

  Widget _historyRow(QueuedPost post) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  post.headline,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (post.error != null)
                  Text(
                    post.error!,
                    style: const TextStyle(fontSize: 12, color: AppColors.warn),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Text(
            post.status.toLowerCase(),
            style: TextStyle(
              fontSize: 12,
              color: post.status == 'POSTED'
                  ? AppColors.success
                  : AppColors.faint,
            ),
          ),
        ],
      ),
    );
  }
}
