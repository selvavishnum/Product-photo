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

  /// Uploads [imageFile], returns the cutout's decoded bytes.
  Future<Uint8List> removeBackground(File imageFile) async {
    final cutoutUrl = await _postImageForUrl(
      endpoint: '/ai/remove-background',
      responseKey: 'cutout_url',
      imageFile: imageFile,
    );
    return _downloadBytes(cutoutUrl);
  }

  /// Re-uploads [cutoutBytes] (from [removeBackground]) with either a preset
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
    final request = http.MultipartRequest('POST', Uri.parse('$baseUrl/shadows'));
    request.files.add(
      http.MultipartFile.fromBytes('image', cutoutBytes, filename: 'cutout.png'),
    );

    final streamed = await request.send();
    final response = await http.Response.fromStream(streamed);

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
    final request = http.MultipartRequest(
      'POST',
      Uri.parse('$baseUrl/ai/virtual-tryon'),
    );
    request.fields['garment_description'] = garmentDescription;
    request.files.add(
      http.MultipartFile.fromBytes('garment_image', garmentBytes, filename: 'garment.png'),
    );

    final streamed = await request.send();
    final response = await http.Response.fromStream(streamed);

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
    final request = http.MultipartRequest('POST', uri);
    request.fields.addAll(fields);

    if (imageFile != null) {
      request.files.add(await http.MultipartFile.fromPath('image', imageFile.path));
    } else if (imageBytes != null) {
      request.files.add(
        http.MultipartFile.fromBytes('image', imageBytes, filename: 'upload.png'),
      );
    } else {
      throw ArgumentError('Either imageFile or imageBytes must be provided');
    }

    final streamed = await request.send();
    final response = await http.Response.fromStream(streamed);

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
}

class ApiException implements Exception {
  ApiException(this.message);

  final String message;

  @override
  String toString() => message;
}
