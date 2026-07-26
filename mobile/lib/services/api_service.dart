import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

/// Talks to the backend's `/ai/*` endpoints (see /backend/main.py).
///
/// [baseUrl] defaults to the hosted Render deployment used elsewhere in this
/// repo. These endpoints call paid fal.ai models -- every call here costs
/// money on whatever fal.ai account the backend is configured with.
class ApiService {
  ApiService({this.baseUrl = 'https://product-photo-backend.onrender.com'});

  final String baseUrl;

  Future<List<String>> fetchThemes() async {
    final response = await http.get(Uri.parse('$baseUrl/ai/themes'));
    if (response.statusCode != 200) {
      throw ApiException('Could not load themes (${response.statusCode})');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return List<String>.from(body['themes'] as List);
  }

  // The paid /ai/remove-background call used to live here. Background
  // removal now runs on the phone (lib/ondevice/) -- it is free, works
  // offline, and does not stop working when the fal.ai balance runs out,
  // which is exactly what happened to this endpoint in practice.

  /// Uploads a cut-out PNG (from the on-device pipeline) with either a preset
  /// [themeKey] or a [customPrompt] -- exactly one should be non-null.
  Future<Uint8List> generateBackground({
    required Uint8List cutoutBytes,
    String? themeKey,
    String? customPrompt,
  }) async {
    final generatedUrl = await _postImageForUrl(
      endpoint: '/ai/generate-background',
      responseKey: 'generated_url',
      imageBytes: cutoutBytes,
      fields: {
        if (themeKey != null) 'theme_key': themeKey,
        if (customPrompt != null && customPrompt.isNotEmpty) 'prompt': customPrompt,
      },
    );
    return _downloadBytes(generatedUrl);
  }

  /// Uploads [imageBytes] to be AI-upscaled (Real-ESRGAN via fal.ai),
  /// returns the upscaled result's decoded bytes. `scale` is a query
  /// param on this endpoint (not a form field, unlike theme_key/prompt).
  Future<Uint8List> upscaleAi({required Uint8List imageBytes, int scale = 2}) async {
    final upscaledUrl = await _postImageForUrl(
      endpoint: '/ai/upscale',
      responseKey: 'upscaled_url',
      imageBytes: imageBytes,
      queryParameters: {'scale': '$scale'},
    );
    return _downloadBytes(upscaledUrl);
  }

  /// Free, classical drop-shadow compositing (no fal.ai call, no cost) --
  /// see backend/services/shadows.py. Returns raw PNG bytes directly,
  /// unlike the /ai/* endpoints which return a JSON-wrapped URL.
  Future<Uint8List> addShadow(Uint8List cutoutBytes) async {
    final response = await _sendWithRetry(() {
      final request = http.MultipartRequest('POST', Uri.parse('$baseUrl/shadows'));
      request.files.add(
        http.MultipartFile.fromBytes('image', cutoutBytes, filename: 'cutout.png'),
      );
      return request;
    }, '/shadows');

    if (response.statusCode != 200) {
      throw ApiException('/shadows failed (${response.statusCode}): ${response.body}');
    }
    return response.bodyBytes;
  }

  /// Places [garmentBytes] (a clothing/jewelry cutout) onto an AI-generated
  /// model via fal.ai's IDM-VTON, described by [garmentDescription].
  Future<Uint8List> virtualTryOn({
    required Uint8List garmentBytes,
    required String garmentDescription,
  }) async {
    final response = await _sendWithRetry(() {
      final request = http.MultipartRequest(
        'POST',
        Uri.parse('$baseUrl/ai/virtual-tryon'),
      );
      request.fields['garment_description'] = garmentDescription;
      request.files.add(
        http.MultipartFile.fromBytes('garment_image', garmentBytes,
            filename: 'garment.png'),
      );
      return request;
    }, '/ai/virtual-tryon');

    if (response.statusCode != 200) {
      throw ApiException(
        '/ai/virtual-tryon failed (${response.statusCode}): ${response.body}',
      );
    }

    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return _downloadBytes(body['result_url'] as String);
  }

  Future<String> _postImageForUrl({
    required String endpoint,
    required String responseKey,
    File? imageFile,
    Uint8List? imageBytes,
    Map<String, String> fields = const {},
    Map<String, String> queryParameters = const {},
  }) async {
    var uri = Uri.parse('$baseUrl$endpoint');
    if (queryParameters.isNotEmpty) {
      uri = uri.replace(queryParameters: queryParameters);
    }

    if (imageFile == null && imageBytes == null) {
      throw ArgumentError('Either imageFile or imageBytes must be provided');
    }

    // Read the file once, up front: the retry loop rebuilds the request on
    // each attempt and re-reading from disk every time would be wasteful.
    final bytes = imageBytes ?? await imageFile!.readAsBytes();
    final filename = imageFile != null ? 'upload.jpg' : 'upload.png';

    final response = await _sendWithRetry(() {
      final request = http.MultipartRequest('POST', uri);
      request.fields.addAll(fields);
      request.files.add(
        http.MultipartFile.fromBytes('image', bytes, filename: filename),
      );
      return request;
    }, endpoint);

    if (response.statusCode != 200) {
      throw ApiException('$endpoint failed (${response.statusCode}): ${response.body}');
    }

    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return body[responseKey] as String;
  }

  Future<Uint8List> _downloadBytes(String url) async {
    final response = await http.get(Uri.parse(url));
    if (response.statusCode != 200) {
      throw ApiException('Could not download result image ($url)');
    }
    return response.bodyBytes;
  }

  /// Sends a multipart request, retrying through the backend's cold start.
  ///
  /// The backend runs on Render's free tier, which sleeps after ~15 minutes
  /// idle and takes ~50s to wake. During that wake the TCP connection is
  /// accepted and then dropped, which surfaces as
  /// `SocketException: Software caused connection abort (errno = 103)` --
  /// not a real failure, just a server that is not up yet. One retry loop
  /// turns that into a slow success instead of an error the user has to
  /// understand.
  ///
  /// [build] must construct a *fresh* request each call: `http.MultipartRequest`
  /// is single-use and cannot be re-sent once its body stream is consumed.
  Future<http.Response> _sendWithRetry(
    http.MultipartRequest Function() build,
    String endpoint,
  ) async {
    var delay = const Duration(seconds: 3);
    Object? lastError;

    for (var attempt = 1; attempt <= _maxAttempts; attempt++) {
      try {
        final streamed = await build().send().timeout(_requestTimeout);
        return await http.Response.fromStream(streamed);
      } on TimeoutException catch (e) {
        lastError = e;
      } on http.ClientException catch (e) {
        lastError = e;
      } on SocketException catch (e) {
        lastError = e;
      }

      if (attempt < _maxAttempts) {
        await Future<void>.delayed(delay);
        delay *= 2;
      }
    }

    throw ApiException(
      "Couldn't reach the server for $endpoint after $_maxAttempts tries.\n\n"
      'The backend sleeps when unused and takes about a minute to wake up. '
      'Wait a moment and try again.\n\n($lastError)',
    );
  }

  /// Long enough to cover a cold start plus a slow AI model, short enough
  /// that a genuinely dead server does not hang the UI indefinitely.
  static const _requestTimeout = Duration(seconds: 120);
  static const _maxAttempts = 3;
}

class ApiException implements Exception {
  ApiException(this.message);

  final String message;

  @override
  String toString() => message;
}
