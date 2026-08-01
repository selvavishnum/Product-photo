import 'package:flutter/material.dart';

import '../theme.dart';

/// The owner passcode input.
///
/// Shared so the explanation is worded the same everywhere it appears. It
/// guards the actions that spend money or publish publicly, and a shop owner
/// who does not know why they are being asked will assume it is a sign-up.
///
/// Stateful because the controller must outlive a rebuild. Creating one in
/// `build` looks harmless and is not: the parent rebuilds on every keystroke
/// (it holds the value), the controller is replaced mid-edit, and the caret
/// jumps to the start of the field.
class PasscodeField extends StatefulWidget {
  const PasscodeField({
    super.key,
    required this.value,
    required this.onChanged,
    this.showHint = true,
  });

  final String value;
  final ValueChanged<String> onChanged;
  final bool showHint;

  @override
  State<PasscodeField> createState() => _PasscodeFieldState();
}

class _PasscodeFieldState extends State<PasscodeField> {
  late final TextEditingController _controller =
      TextEditingController(text: widget.value);

  @override
  void didUpdateWidget(PasscodeField oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Only when something other than this field changed the value -- e.g. a
    // saved passcode loading in. Writing back the value we just emitted would
    // move the caret on every keystroke.
    if (widget.value != _controller.text) {
      _controller.text = widget.value;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(
          controller: _controller,
          obscureText: true,
          onChanged: widget.onChanged,
          decoration: appInput('Owner passcode'),
        ),
        if (widget.showHint) ...[
          const SizedBox(height: 6),
          const Text(
            'Only you should be able to spend your ad budget.',
            style: TextStyle(fontSize: 12, color: AppColors.faint),
          ),
        ],
      ],
    );
  }
}
