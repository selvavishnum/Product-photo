import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

/// Client for the Ad Auto-Pilot API (see /marketing-autopilot/web).
///
/// **The app holds no API keys.** Gemini and Meta credentials live only on
/// the server, and that is not a stylistic choice: an APK can be decompiled,
/// and a leaked Meta System User token spends the shop's real ad budget with
/// no way to notice until the bill arrives. The phone sends the owner
/// passcode and nothing else.
///
/// That also means the rules that protect the owner -- the daily budget
/// ceiling, campaigns created paused, the passcode gate -- are enforced
/// server-side and cannot be edited out of a build.
class AdPilotApi {
  AdPilotApi({
    this.baseUrl = 'https://product-photo-ecru.vercel.app',
    http.Client? client,
  }) : _client = client ?? http.Client();

  final String baseUrl;
  final http.Client _client;

  /// Sent on every call that can spend money or publish publicly.
  String? passcode;

  /// Attaches a file with its real content type.
  ///
  /// `MultipartFile.fromPath` defaults to `application/octet-stream` when no
  /// contentType is given, and the server checks that an upload declares
  /// itself as an image -- so without this every photo is rejected with
  /// "Uploaded file must be an image", which is both true of the header and
  /// wrong about the file.
  static Future<http.MultipartFile> _imageField(File image) async {
    final ext = image.path.toLowerCase().split('.').last;
    final subtype = switch (ext) {
      'png' => 'png',
      'webp' => 'webp',
      'heic' || 'heif' => 'heic',
      _ => 'jpeg',
    };
    return http.MultipartFile.fromPath(
      'image',
      image.path,
      contentType: MediaType('image', subtype),
    );
  }

  Map<String, String> get _authHeaders =>
      passcode == null ? const {} : {'x-owner-passcode': passcode!};

  /// Writes ad copy and a targeting plan. Free -- spends model quota, not
  /// rupees -- so this one needs no passcode.
  Future<AdPlan> generateAd({
    required String businessName,
    required String businessCategory,
    required String description,
    String? city,
    required String language,
    required int dailyBudgetInr,
    File? image,
  }) async {
    final request =
        http.MultipartRequest('POST', Uri.parse('$baseUrl/api/v1/ad/generate'))
          ..fields['businessName'] = businessName
          ..fields['businessCategory'] = businessCategory
          ..fields['description'] = description
          ..fields['language'] = language
          ..fields['dailyBudgetInr'] = '$dailyBudgetInr';
    if (city != null && city.isNotEmpty) request.fields['city'] = city;
    if (image != null) {
      request.files.add(await _imageField(image));
    }

    final body = await _send(request);
    return AdPlan.fromJson(body);
  }

  /// Creates a **paused** Meta campaign. Nothing spends until the owner
  /// switches it on in Ads Manager.
  Future<PublishResult> publishCampaign({
    required AdPlan plan,
    required String businessName,
    required String language,
    required File image,
  }) async {
    final request = http.MultipartRequest(
      'POST',
      Uri.parse('$baseUrl/api/v1/campaign/publish'),
    )
      ..headers.addAll(_authHeaders)
      ..fields['plan'] = jsonEncode({
        'businessName': businessName,
        'language': language,
        'dailyBudgetInr': plan.dailyBudgetInr,
        'targeting': plan.targeting.toJson(),
        'copies': plan.copies.map((c) => c.toJson()).toList(),
      });
    request.files.add(await _imageField(image));

    return PublishResult.fromJson(await _send(request));
  }

  /// Posts to the shop's own Instagram feed. Free, but it publishes publicly
  /// under the owner's name, so it is gated the same way.
  Future<InstagramPost> postToInstagram({
    required AdCopy copy,
    required File image,
  }) async {
    final request = http.MultipartRequest(
      'POST',
      Uri.parse('$baseUrl/api/v1/instagram/post'),
    )
      ..headers.addAll(_authHeaders)
      ..fields['copy'] = jsonEncode(copy.toJson());
    request.files.add(await _imageField(image));

    return InstagramPost.fromJson(await _send(request));
  }

  /* ---------------- daily post queue ---------------- */

  Future<QueueState> loadQueue() async {
    final response = await _client.get(
      Uri.parse('$baseUrl/api/v1/queue'),
      headers: _authHeaders,
    );
    return QueueState.fromJson(_decode(response));
  }

  Future<void> saveShopProfile({
    required String businessName,
    required String category,
    required String description,
    String? city,
    required String language,
    File? image,
  }) async {
    final request =
        http.MultipartRequest('POST', Uri.parse('$baseUrl/api/v1/queue'))
          ..headers.addAll(_authHeaders)
          ..fields['action'] = 'profile'
          ..fields['profile'] = jsonEncode({
            'businessName': businessName,
            'category': category,
            'description': description,
            if (city != null && city.isNotEmpty) 'city': city,
            'language': language,
          });
    if (image != null) {
      request.files.add(await _imageField(image));
    }
    await _send(request);
  }

  Future<void> actOnPost(String id, {required bool approve}) async {
    final request =
        http.MultipartRequest('POST', Uri.parse('$baseUrl/api/v1/queue'))
          ..headers.addAll(_authHeaders)
          ..fields['action'] = approve ? 'approve' : 'skip'
          ..fields['id'] = id;
    await _send(request);
  }

  /* ---------------- plumbing ---------------- */

  /// Sends with retries.
  ///
  /// A MultipartRequest is single-use -- its body stream is consumed on the
  /// first send -- so each attempt rebuilds it rather than resending the same
  /// object, which fails with a StateError rather than retrying.
  Future<Map<String, dynamic>> _send(http.MultipartRequest request) async {
    const attempts = 3;
    Object? lastError;

    for (var attempt = 0; attempt < attempts; attempt++) {
      final copy = http.MultipartRequest(request.method, request.url)
        ..headers.addAll(request.headers)
        ..fields.addAll(request.fields)
        ..files.addAll(request.files);
      try {
        final streamed = await _client.send(copy);
        return _decode(await http.Response.fromStream(streamed));
      } on ApiException {
        // The server answered and said no. Retrying will get the same
        // answer, and if the call had a side effect a retry could repeat it.
        rethrow;
      } catch (err) {
        lastError = err;
        if (attempt < attempts - 1) {
          await Future<void>.delayed(Duration(seconds: 2 << attempt));
        }
      }
    }
    throw ApiException('Could not reach the server. Check your connection.\n'
        '$lastError');
  }

  Map<String, dynamic> _decode(http.Response response) {
    Map<String, dynamic> body;
    try {
      body = jsonDecode(response.body) as Map<String, dynamic>;
    } catch (_) {
      throw ApiException('Unexpected reply from the server '
          '(${response.statusCode}).');
    }

    if (response.statusCode >= 400) {
      final error = body['error'] as Map<String, dynamic>?;
      // Field-level validation issues come back as a list; the first one is
      // the actionable message.
      final details = error?['details'];
      final detail = details is List && details.isNotEmpty
          ? (details.first as Map<String, dynamic>)['message'] as String?
          : null;
      throw ApiException(
        detail ?? error?['message'] as String? ?? 'Something went wrong.',
        statusCode: response.statusCode,
        isPolicy: error?['isPolicy'] == true,
      );
    }
    return body;
  }
}

class ApiException implements Exception {
  ApiException(this.message, {this.statusCode, this.isPolicy = false});

  final String message;
  final int? statusCode;

  /// Meta rejected the ad on policy grounds. The owner has to reword it --
  /// retrying unchanged will fail the same way.
  final bool isPolicy;

  /// The passcode was wrong or missing.
  bool get isUnauthorised => statusCode == 401;

  /// The server is missing configuration (no token, no database, no storage).
  bool get isNotConfigured => statusCode == 503;

  @override
  String toString() => message;
}

/* ---------------- models ---------------- */

class AdCopy {
  const AdCopy({
    required this.language,
    required this.headline,
    required this.primaryText,
    required this.cta,
  });

  final String language;
  final String headline;
  final String primaryText;
  final String cta;

  factory AdCopy.fromJson(Map<String, dynamic> json) => AdCopy(
        language: json['language'] as String? ?? '',
        headline: json['headline'] as String? ?? '',
        primaryText: json['primaryText'] as String? ?? '',
        cta: json['cta'] as String? ?? '',
      );

  Map<String, dynamic> toJson() => {
        'language': language,
        'headline': headline,
        'primaryText': primaryText,
        'cta': cta,
      };

  /// What gets handed to WhatsApp. Blank lines between the parts because one
  /// dense paragraph does not get read in a chat.
  String get shareText => '$headline\n\n$primaryText\n\n$cta';
}

class Targeting {
  const Targeting({
    required this.ageMin,
    required this.ageMax,
    required this.locationName,
    required this.locationRadiusKm,
    required this.rationale,
    required this.raw,
  });

  final int ageMin;
  final int ageMax;
  final String locationName;
  final int locationRadiusKm;
  final String rationale;

  /// Kept whole so publishing can send back exactly what the server produced,
  /// including fields this screen does not display.
  final Map<String, dynamic> raw;

  factory Targeting.fromJson(Map<String, dynamic> json) => Targeting(
        ageMin: json['ageMin'] as int? ?? 18,
        ageMax: json['ageMax'] as int? ?? 65,
        locationName: json['locationName'] as String? ?? '',
        locationRadiusKm: json['locationRadiusKm'] as int? ?? 5,
        rationale: json['rationale'] as String? ?? '',
        raw: json,
      );

  Map<String, dynamic> toJson() => raw;
}

class AdPlan {
  const AdPlan({
    required this.copies,
    required this.targeting,
    required this.dailyBudgetInr,
  });

  final List<AdCopy> copies;
  final Targeting targeting;
  final int dailyBudgetInr;

  factory AdPlan.fromJson(Map<String, dynamic> json) {
    final plan = json['plan'] as Map<String, dynamic>;
    final input = json['input'] as Map<String, dynamic>? ?? const {};
    return AdPlan(
      copies: (plan['copies'] as List)
          .map((c) => AdCopy.fromJson(c as Map<String, dynamic>))
          .toList(),
      targeting: Targeting.fromJson(plan['targeting'] as Map<String, dynamic>),
      dailyBudgetInr: input['dailyBudgetInr'] as int? ?? 0,
    );
  }

  /// The copy in the language the owner asked for. "First in the list" is not
  /// a choice anyone made, and an ad nobody local can read is wasted budget.
  AdCopy preferred(String language) => copies.firstWhere(
        (c) => c.language == language,
        orElse: () => copies.first,
      );
}

class PublishResult {
  const PublishResult({
    required this.adId,
    required this.note,
    this.matchedLocation,
  });

  final String adId;
  final String note;
  final String? matchedLocation;

  factory PublishResult.fromJson(Map<String, dynamic> json) => PublishResult(
        adId: json['adId'] as String? ?? '',
        note: json['note'] as String? ?? '',
        matchedLocation: json['matchedLocation'] as String?,
      );
}

class InstagramPost {
  const InstagramPost({required this.postId, this.permalink});

  final String postId;
  final String? permalink;

  factory InstagramPost.fromJson(Map<String, dynamic> json) => InstagramPost(
        postId: json['postId'] as String? ?? '',
        permalink: json['permalink'] as String?,
      );
}

class ShopProfile {
  const ShopProfile({
    required this.businessName,
    required this.category,
    required this.description,
    this.city,
    required this.language,
    this.imageUrl,
  });

  final String businessName;
  final String category;
  final String description;
  final String? city;
  final String language;
  final String? imageUrl;

  factory ShopProfile.fromJson(Map<String, dynamic> json) => ShopProfile(
        businessName: json['business_name'] as String? ?? '',
        category: json['category'] as String? ?? '',
        description: json['description'] as String? ?? '',
        city: json['city'] as String?,
        language: json['language'] as String? ?? 'TAMIL',
        imageUrl: json['image_url'] as String?,
      );
}

class QueuedPost {
  const QueuedPost({
    required this.id,
    required this.headline,
    required this.primaryText,
    required this.cta,
    required this.status,
    this.imageUrl,
    this.error,
    this.permalink,
  });

  final String id;
  final String headline;
  final String primaryText;
  final String cta;
  final String status;
  final String? imageUrl;
  final String? error;
  final String? permalink;

  bool get isPending => status == 'PENDING';

  factory QueuedPost.fromJson(Map<String, dynamic> json) => QueuedPost(
        id: '${json['id']}',
        headline: json['headline'] as String? ?? '',
        primaryText: json['primary_text'] as String? ?? '',
        cta: json['cta'] as String? ?? '',
        status: json['status'] as String? ?? 'PENDING',
        imageUrl: json['image_url'] as String?,
        error: json['error'] as String?,
        permalink: json['permalink'] as String?,
      );
}

class QueueState {
  const QueueState({
    required this.posts,
    required this.autoPost,
    this.profile,
  });

  final List<QueuedPost> posts;
  final bool autoPost;
  final ShopProfile? profile;

  List<QueuedPost> get pending =>
      posts.where((p) => p.isPending).toList(growable: false);
  List<QueuedPost> get history =>
      posts.where((p) => !p.isPending).toList(growable: false);

  factory QueueState.fromJson(Map<String, dynamic> json) => QueueState(
        posts: (json['posts'] as List? ?? const [])
            .map((p) => QueuedPost.fromJson(p as Map<String, dynamic>))
            .toList(),
        autoPost: json['autoPost'] == true,
        profile: json['profile'] == null
            ? null
            : ShopProfile.fromJson(json['profile'] as Map<String, dynamic>),
      );
}
