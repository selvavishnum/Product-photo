/**
 * Background presets for the studio-shot generator.
 *
 * Split out from productShot.ts so the picker can import it. That module
 * imports the Gemini SDK and reads process.env; importing it from a client
 * component would pull the whole SDK into the browser bundle.
 */

/** Scene presets. Saffron and maroon first -- they are what gets asked for. */
export const SCENES = [
  {
    key: 'studio',
    name: 'Studio white',
    tamil: 'ஸ்டூடியோ',
    prompt:
      'a seamless pure white studio backdrop with soft diffused light from ' +
      'the upper left and a gentle contact shadow beneath the product',
  },
  {
    key: 'saffron',
    name: 'Saffron silk',
    tamil: 'குங்குமம்',
    prompt:
      'rich saffron and warm amber silk draped behind and beneath the ' +
      'product, soft folds catching warm golden light, festive but uncluttered',
  },
  {
    key: 'maroon',
    name: 'Maroon velvet',
    tamil: 'மெரூன்',
    prompt:
      'deep maroon velvet, dark and softly lit like a jeweller\'s display, ' +
      'a narrow pool of warm light on the product and the corners falling away',
  },
  {
    key: 'marble',
    name: 'Marble',
    tamil: 'பளிங்கு',
    prompt:
      'a polished white marble surface with faint grey veining, bright even ' +
      'daylight, a clean pale background well out of focus',
  },
  {
    key: 'wood',
    name: 'Wooden table',
    tamil: 'மரம்',
    prompt:
      'a warm brown wooden table top, morning window light raking across the ' +
      'grain, the background a softly blurred shop interior',
  },
  {
    key: 'festive',
    name: 'Festive',
    tamil: 'பண்டிகை',
    prompt:
      'a festive Indian setting with brass oil lamps and marigold flowers ' +
      'blurred well behind the product, warm candlelight, nothing overlapping ' +
      'the product itself',
  },
] as const;

export type SceneKey = (typeof SCENES)[number]['key'];

export function findScene(key: string) {
  return SCENES.find((s) => s.key === key) ?? SCENES[0];
}

/**
 * The four slides of a carousel, in the order they are swiped.
 *
 * Not four variations of the same picture. A carousel earns its extra reach
 * from people swiping, and they swipe when each slide answers a question the
 * one before it raised: what is it, what does it look like close up, what is
 * it like to own, what do I do now.
 */
export const SLIDES = [
  {
    key: 'hero',
    name: 'Hero',
    tamil: 'முதல் படம்',
    prompt:
      'a straight-on hero shot of the whole product, centred, filling most ' +
      'of the frame',
  },
  {
    key: 'detail',
    name: 'Close-up',
    tamil: 'நெருக்கம்',
    prompt:
      'a tight close-up of the most interesting part of the product -- the ' +
      'texture, the finish, the craftsmanship -- shallow depth of field',
  },
  {
    key: 'lifestyle',
    name: 'In use',
    tamil: 'பயன்பாடு',
    prompt:
      'the product placed where it would actually be used in an Indian home ' +
      'or shop, still the clear subject, the setting softly out of focus',
  },
  {
    key: 'offer',
    name: 'Offer',
    tamil: 'சலுகை',
    prompt:
      'the product to one side with generous empty space on the other, ' +
      'ready for the offer to be read against it',
  },
] as const;

export type SlideKey = (typeof SLIDES)[number]['key'];

export function findSlide(key: string | undefined) {
  return SLIDES.find((s) => s.key === key);
}
