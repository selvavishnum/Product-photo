import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../services/adpilot_api.dart';
import '../../theme.dart';
import '../../widgets/step_shell.dart';
import 'ad_result_screen.dart';

/// The ad wizard: six questions, one per screen.
///
/// Deliberate choices, the same ones the web flow makes:
///
///  - **Budget is preset choices, not a number field.** "How much per day?"
///    as free input asks someone to guess a number they have no basis for,
///    and it is where people abandon.
///  - **Nothing is pre-selected.** A pre-ticked budget is a spending decision
///    nobody made.
///  - **No advertising vocabulary.** No objective, optimisation goal, bid
///    strategy or CPM anywhere -- those are chosen server-side.
///  - **Each answer gets an immediate line** saying what it will cause, so
///    the consequence lands when the choice is made rather than two screens
///    later.
class AdWizardScreen extends StatefulWidget {
  const AdWizardScreen({super.key, this.api});

  /// Injectable for tests; the app builds its own.
  final AdPilotApi? api;

  @override
  State<AdWizardScreen> createState() => _AdWizardScreenState();
}

class _AdWizardScreenState extends State<AdWizardScreen> {
  static const _totalSteps = 6;

  static const _languages = [
    ('TAMIL', 'தமிழ்', 'Tamil script'),
    ('TANGLISH', 'Tanglish', 'Tamil in English letters'),
    ('ENGLISH', 'English', ''),
  ];

  static const _budgets = [
    (150, '₹150 a day', 'Try it for a few days'),
    (300, '₹300 a day', 'Where most local shops start'),
    (600, '₹600 a day', 'Festival or opening week'),
  ];

  late final AdPilotApi _api = widget.api ?? AdPilotApi();

  int _step = 1;

  final _businessName = TextEditingController();
  final _category = TextEditingController();
  final _description = TextEditingController();
  final _city = TextEditingController();
  String _language = 'TAMIL';
  int _budget = 0;
  File? _image;

  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _businessName.dispose();
    _category.dispose();
    _description.dispose();
    _city.dispose();
    super.dispose();
  }

  void _next() => setState(() => _step++);
  void _back() => setState(() => _step--);

  Future<void> _pickImage() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery);
    if (picked != null) setState(() => _image = File(picked.path));
  }

  Future<void> _generate() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final plan = await _api.generateAd(
        businessName: _businessName.text.trim(),
        businessCategory: _category.text.trim(),
        description: _description.text.trim(),
        city: _city.text.trim(),
        language: _language,
        dailyBudgetInr: _budget,
        image: _image,
      );
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => AdResultScreen(
            api: _api,
            plan: plan,
            businessName: _businessName.text.trim(),
            language: _language,
            image: _image,
          ),
        ),
      );
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Could not reach the server. Check your '
            'connection.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return StepShell(
      step: _step,
      total: _totalSteps,
      onBack: _step == 1 ? null : _back,
      child: switch (_step) {
        1 => _textStep(
            title: 'What is your shop called?',
            tamil: 'கடையின் பெயர்?',
            controller: _businessName,
            placeholder: 'Sri Lakshmi Jewellers',
          ),
        2 => _textStep(
            title: 'What do you sell?',
            tamil: 'என்ன விற்கிறீர்கள்?',
            controller: _category,
            placeholder: 'Jewellery shop',
          ),
        3 => _descriptionStep(),
        4 => _cityStep(),
        5 => _languageAndPhotoStep(),
        _ => _budgetStep(),
      },
    );
  }

  Widget _textStep({
    required String title,
    required String tamil,
    required TextEditingController controller,
    required String placeholder,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Question(title: title, tamil: tamil),
        TextField(
          controller: controller,
          autofocus: true,
          onChanged: (_) => setState(() {}),
          decoration: appInput(placeholder),
        ),
        const SizedBox(height: 32),
        PrimaryButton(
          label: 'Continue',
          onPressed: controller.text.trim().isEmpty ? null : _next,
        ),
      ],
    );
  }

  Widget _descriptionStep() {
    final ready = _description.text.trim().length >= 10;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Question(
          title: 'What do you want to advertise?',
          tamil: 'எதை விளம்பரப்படுத்த வேண்டும்?',
          hint: 'A sentence or two. The more you say, the better the ad.',
        ),
        TextField(
          controller: _description,
          autofocus: true,
          maxLines: 5,
          onChanged: (_) => setState(() {}),
          decoration: appInput('Bridal sets and daily-wear gold chains. We want more '
                'customers for the wedding season.'),
        ),
        if (ready) ...[
          const SizedBox(height: 20),
          const Note.info(
            'Good. We will write the ad from this and invent nothing you '
            'have not said.',
          ),
        ],
        const SizedBox(height: 32),
        PrimaryButton(label: 'Continue', onPressed: ready ? _next : null),
      ],
    );
  }

  Widget _cityStep() {
    final city = _city.text.trim();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Question(
          title: 'Which town are you in?',
          tamil: 'எந்த ஊர்?',
          hint: 'We advertise only to people near you.',
        ),
        TextField(
          controller: _city,
          autofocus: true,
          onChanged: (_) => setState(() {}),
          decoration: appInput('Thuckalay'),
        ),
        if (city.isNotEmpty) ...[
          const SizedBox(height: 20),
          Note.info(
            'Your ad will go to people around $city, not the whole state — a '
            'small budget spread wide reaches nobody often enough.',
          ),
        ],
        const SizedBox(height: 32),
        PrimaryButton(label: 'Continue', onPressed: city.isEmpty ? null : _next),
      ],
    );
  }

  Widget _languageAndPhotoStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Question(
          title: 'Which language?',
          tamil: 'எந்த மொழி?',
          hint: 'Whatever your customers read most comfortably.',
        ),
        for (final (value, label, hint) in _languages)
          Choice(
            label: label,
            hint: hint,
            selected: _language == value,
            onSelect: () => setState(() => _language = value),
          ),
        const SizedBox(height: 24),
        const Text(
          'Product photo',
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 8),
        SecondaryButton(
          label: _image == null ? 'Choose a photo' : 'Change photo',
          onPressed: _pickImage,
        ),
        const SizedBox(height: 8),
        Text(
          _image == null
              // Honest about why: it is optional for the words, required for
              // anything that publishes.
              ? 'Needed to post on Instagram or run a paid ad.'
              : 'Photo added.',
          style: const TextStyle(fontSize: 12, color: AppColors.faint),
        ),
        const SizedBox(height: 32),
        PrimaryButton(label: 'Continue', onPressed: _next),
      ],
    );
  }

  Widget _budgetStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Question(
          title: 'How much per day?',
          tamil: 'ஒரு நாளைக்கு எவ்வளவு?',
          hint: 'Only matters if you run a paid ad. Sharing is free.',
        ),
        for (final (inr, label, hint) in _budgets)
          Choice(
            label: label,
            hint: hint,
            selected: _budget == inr,
            onSelect: () => setState(() => _budget = inr),
          ),
        if (_budget > 0) ...[
          const SizedBox(height: 20),
          Note.info(
            'We will suggest how far around '
            '${_city.text.trim().isEmpty ? 'you' : _city.text.trim()} to '
            'advertise based on this. A bigger area needs a bigger budget to '
            'work.',
          ),
        ],
        if (_error != null) ...[
          const SizedBox(height: 20),
          Note.warning(_error!),
        ],
        const SizedBox(height: 32),
        PrimaryButton(
          label: _loading ? 'Writing your ad…' : 'Make my ad',
          busy: _loading,
          onPressed: _budget == 0 ? null : _generate,
        ),
      ],
    );
  }
}
