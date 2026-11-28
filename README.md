# clicktone

Play UI sounds through the Web Audio API, with typed events, a shared audio context, and audio unlocking for iOS and Safari.

[![npm](https://img.shields.io/npm/v/clicktone.svg?colorB=brightgreen)](https://www.npmjs.com/package/clicktone)
[![NPM Downloads](https://img.shields.io/npm/dm/clicktone.svg?style=flat)](https://www.npmjs.com/package/clicktone)

[Demo](https://codepen.io/ux-ui/pen/yLwbmMr)

## Installation

```bash
npm install clicktone
```

## Quick start

In a browser app with a bundler, serve a short audio file at `/audio/click.mp3`. Add a button, then run the TypeScript module after the button exists:

```html
<button id="click-button" type="button">Play sound</button>
```

```ts
import { ClickTone } from 'clicktone';

const button = document.getElementById('click-button');

if (!button) {
  throw new Error('Click button was not found');
}

const sound = new ClickTone({
  src: '/audio/click.mp3',
  volume: 0.7,
  throttle: 100,
  pitchVariation: 0.08,
  preload: true,
});

sound.on('error', (error) => console.error(error));
button.addEventListener('click', () => void sound.play());
```

Each click plays the sound. `preload: true` fetches and decodes it in advance; playback still needs a user interaction to unlock browser audio. Call `sound.destroy()` when you no longer need the instance.

## API

`new ClickTone(options)` creates a sound instance that uses the shared audio engine. The package also exports its TypeScript types, including `ClickToneOptions`, `SoundInput`, `PlayOptions`, and `ReplayBehavior`.

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `src` | `SoundInput` | Required | Audio source or list of format alternatives; see below. |
| `volume` | `number` | `1` | Playback volume, from `0` to `1`. |
| `muted` | `boolean` | `false` | Start muted. Change it later with `setMuted()` or `toggleMuted()`. |
| `throttle` | `number` | `0` | Minimum interval between accepted `play()` calls, in milliseconds. Earlier requests are ignored. |
| `pitchVariation` | `number` | `0` | Random playback-rate variation, from `0` to `1`, so repeated clicks do not sound identical. Changes both pitch and duration. |
| `preload` | `boolean` | `false` | Fetch and decode the sound when the instance is created. |
| `loop` | `boolean` | `false` | Keep playing until `stop()` is called. |
| `replay` | `ReplayBehavior` | `'overlap'` | What happens when this instance is already playing; see Replay behavior. |
| `fallback` | `boolean` | `false` | Try other source URLs if fetching or decoding the selected source fails. Applies to `preload()` and `play()`. |
| `maxVoices` | `number \| null` | `null` | Optional limit on started sources for this instance. A new source stops the oldest when the limit is reached. |
| `debug` | `boolean` | `false` | Log internal errors to the console as well as emitting the `error` event. |

`SoundInput` accepts one source or an array of sources:

```ts
type SoundSource =
  | string
  | URL
  | { src: string; type?: string }
  | { id: string }
  | HTMLSourceElement
  | HTMLAudioElement;

type SoundInput = SoundSource | SoundSource[];
```

For an `HTMLAudioElement`, its child `<source>` elements form the list of alternatives. `{ id }` refers to an audio or source element by its DOM id. For a list, ClickTone prefers a format that `canPlayType` reports as playable; if none is recognized, it uses the first source. Retrying other URLs after a load failure requires `fallback: true`.

### Methods

The following methods belong to the `sound` instance from Quick start:

| Method | Returns | Description |
| --- | --- | --- |
| `play(input?)` | `Promise<void>` | Play the configured sound, a different `SoundInput`, or a `PlayOptions` object. Resolves when non-looped playback ends or is stopped, when a loop starts, or when a pending request is cancelled. |
| `preload()` | `Promise<AudioBuffer \| undefined>` | Fetch and decode the configured sound. Returns `undefined` when no buffer is available or loading fails. |
| `unload()` | `boolean` | Remove all configured source URLs from the shared cache, including alternatives. Returns whether any entry was removed; playback and loading continue. |
| `stop()` | `void` | Cancel pending play requests and stop all active playback on this instance. |
| `unlock()` | `void` | Resume the shared audio context. Call inside a user gesture. |
| `setVolume(value)` | `void` | Set playback volume from `0` to `1`. |
| `setMuted(muted)` | `void` | Set the muted state. |
| `toggleMuted()` | `boolean` | Toggle muting and return the new muted state. |
| `on(type, listener)` | `() => void` | Subscribe to an event and return an unsubscribe function. The listener receives the event detail. |
| `once(type, listener)` | `void` | Subscribe to the next occurrence of an event. The listener receives the event detail. |
| `destroy()` | `void` | Cancel pending play requests, stop playback, and release this instance's audio resources and lifecycle listeners. Safe to call more than once. |

Read the current state through `sound.playing`, `sound.voiceCount`, `sound.volume`, and `sound.muted`.

`voiceCount` counts started sources, including loops, and `playing` is `true` while at least one source is active. Pending requests waiting for unlock or loading are excluded from both values. A pending request still counts for `ignore-if-playing`.

`ClickTone.unlock()` resumes the shared context from a global gesture handler. `ClickTone.unlocked` reports whether it has been unlocked.

A `PlayOptions` object can override `src`, `loop`, `replay`, and `fallback` for one call. For example, continuing with the `sound` instance above and an audio file at `/audio/win.mp3`:

```ts
await sound.play({ src: '/audio/win.mp3', replay: 'interrupt' });
```

Loading, decoding, and playback errors are reported through the `error` event. Listen for that event even when awaiting `play()` or `preload()`.

`play()` keeps waiting if the browser requires a user gesture to resume audio; there is no fixed unlock timeout. `stop()` and `destroy()` cancel that wait immediately, and a later gesture will not start the cancelled request. Cancellation resolves the promise without emitting `error` or `end`. A request skipped by `throttle` or `ignore-if-playing` also resolves without starting playback.

`destroy()` prevents later playback and suppresses subsequent instance events, including results from a pending `preload()`. Shared loading can continue for other instances; destroying one sound does not cancel another sound's fetch or decode. After destruction, `play()` does nothing and `preload()` returns `undefined`.

### Events

`ClickTone` extends `EventTarget`. Use the typed `on()` and `once()` helpers, or native `addEventListener`. Native listeners receive a `CustomEvent` with the payload in `event.detail`.

| Event | When | Payload |
| --- | --- | --- |
| `play` | A buffer source starts. | None |
| `end` | Playback finishes naturally. | None |
| `stop` | One or more started sources are stopped by `stop()`, replay replacement, or a voice limit. Cancelling only pending requests does not emit it. | None |
| `unlock` | The shared audio engine is first unlocked, or an instance is created after it has been unlocked. | None |
| `load` | `preload()` fetches and decodes a source. | `AudioBuffer` |
| `error` | Loading, decoding, or playback fails. | `Error` |

`unlock` is emitted at most once per instance. For an instance created after the shared engine is unlocked, it is emitted synchronously during construction, before a listener can be attached. Check `ClickTone.unlocked` to handle that case.

Continuing with `sound` from Quick start:

```ts
const off = sound.on('end', () => console.log('finished'));
const onUnlocked = () => console.log('audio unlocked');

if (ClickTone.unlocked) {
  onUnlocked();
} else {
  sound.once('unlock', onUnlocked);
}

// When this subscription is no longer needed:
off();
```

## Replay behavior

- `'overlap'` (default): every accepted `play()` call starts another buffer source, subject to `maxVoices`.
- `'interrupt'`: cancel pending requests and stop active playback, then play the requested sound. Throttle still applies.
- `'ignore-if-playing'`: ignore the request while this instance is playing or has a pending play request.
- `'restart'`: cancel pending requests and stop active playback, then start again, bypassing `throttle`.

For looped playback, `play()` resolves once the loop starts. Call `stop()` to end it.

With `interrupt` or `restart`, only the latest accepted request can start, even if an older request finishes loading later. `overlap` allows concurrent requests to start independently.

## Voice limits

Use `maxVoices` to bound overlapping playback for one instance:

```ts
const click = new ClickTone({
  src: '/audio/click.mp3',
  preload: true,
  maxVoices: 4,
});
```

The limit counts started sources, including loops. Pending requests do not occupy a voice. When a new source is ready to start at the limit, the oldest started source is stopped to make room. Existing sources keep playing while the new request loads; loading or source preparation failures do not displace them. Oldest is determined by actual start order, which can differ from request order when files finish loading at different times.

Displacing a voice emits `stop`, resolves its pending non-looped `play()` promise, and does not emit `end`. A displaced loop is not restored during context recovery. `sound.voiceCount` reports the current number of active voices.

The limit applies independently to each instance. `ignore-if-playing` and `throttle` can skip a request before any voice is displaced; `interrupt` and `restart` keep their existing replacement behavior. By default `maxVoices` is `null`, preserving unlimited overlap. A specified limit must be a positive safe integer; invalid values throw `RangeError` from the constructor.

## Cache management

Decoded buffers are shared between instances. By default there is no automatic eviction, so loaded sounds stay ready until explicitly cleared or until the audio context is rebuilt. `destroy()` leaves the shared cache intact.

Use the static API to manage this cache for all instances:

| API | Description |
| --- | --- |
| `ClickTone.setCacheLimit(maxBytes)` | Set an optional decoded PCM byte budget. `null` (default) disables eviction; `0` disables retention of decoded buffers. |
| `ClickTone.clearCache(src?)` | Clear the whole cache, or just the source selected from a `SoundInput`. For format alternatives, only the selected URL is cleared. |
| `ClickTone.cacheStats` | Read a snapshot with `entries` (retained buffers), `pending` (loads tracked for sharing), `bytes` (retained PCM bytes), and `maxBytes`. |

For example, enable a 16 MiB budget before preloading your sound catalog:

```ts
ClickTone.setCacheLimit(16 * 1024 * 1024);
console.log(ClickTone.cacheStats);
```

When a limit is enabled, the cache evicts the least recently requested decoded buffers to stay within that budget. Lowering the limit applies immediately. A sound larger than the budget can still load and play, but is not retained and does not displace smaller cached sounds. Concurrent requests for a sound share its in-progress load even when retention is disabled. Call `ClickTone.setCacheLimit(null)` to disable eviction again.

Using `sound` from Quick start, call `sound.unload()` to remove all its configured source URLs, or `ClickTone.clearCache('/audio/win.mp3')` to remove a source played through an override. These changes affect future requests from every instance using the same source; they do not stop active sounds or cancel existing loads. A load removed from the cache can still finish for its current callers, but its result will not repopulate that cleared entry. A later request can start a fresh load. Clearing the cache preserves the configured limit.

The byte count is `buffer.length * buffer.numberOfChannels * 4`. This measures retained decoded PCM, not total application memory: active playback, buffers kept by callers of `preload()`, in-progress loading, browser overhead, and the browser's HTTP cache have their own lifetimes.

Invalid limits (negative, fractional, non-finite, or unsafe integers) throw `RangeError`. Invalid sources passed to the static `clearCache(src)` method throw synchronously.

## Provide format alternatives

In the same browser setup as Quick start, supply your audio files in more than one format:

```ts
const fallbackSound = new ClickTone({
  src: ['/audio/click.aac', '/audio/click.ogg', '/audio/click.mp3'],
  fallback: true,
});
```

The selected format is tried first. With `fallback: true`, a failed fetch, HTTP response, response-body read, or audio decode advances to the remaining unique URLs in their declared order. Attempts run sequentially and stop at the first successful buffer. Errors starting the audio context or starting playback do not trigger another file attempt.

Fallback is disabled by default. Enable or disable it for a single request with `sound.play({ fallback: true })` or `sound.play({ fallback: false })`; a source override inherits the instance setting unless explicitly overridden. `preload()` uses the instance setting.

Intermediate failures do not emit `error`. If every attempted URL fails, one `error` event contains an `AggregateError` whose `errors` are the original failures in attempt order and whose message lists the attempted URLs. A single unique URL preserves its original error. As with other failures, `play()` resolves and `preload()` returns `undefined`.

Each new request starts with the selected format again, so a temporary failure can recover. Successful alternatives use the same shared URL cache as other sounds; failures are not cached. Cancelling a play request prevents further attempts for that request without cancelling loads shared by other instances. `sound.unload()` removes all configured alternatives; static `ClickTone.clearCache(list)` continues to clear only the selected URL.

## Play a loop and a completion sound

Using the `ClickTone` import from Quick start, serve files at `/audio/flying.mp3` and `/audio/bonus.mp3`. Create separate instances for the continuous sound and the completion sound:

```ts
const flying = new ClickTone({
  src: '/audio/flying.mp3',
  loop: true,
  preload: true,
});

const bonus = new ClickTone({
  src: '/audio/bonus.mp3',
  preload: true,
});

// Inside a user interaction that starts the process:
await flying.play();

// When the process finishes:
flying.stop();
await bonus.play();
```

The two parts run at different points in your app's lifecycle. Destroy both instances when that part of the app is removed.

## Vue 3

Import `ClickTone` from the main package entry. This component uses the same `/audio/click.mp3` file as Quick start:

```vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef } from 'vue';
import { ClickTone } from 'clicktone';

const sound = shallowRef<ClickTone | null>(null);

onMounted(() => {
  sound.value = new ClickTone({
    src: '/audio/click.mp3',
    volume: 0.7,
    pitchVariation: 0.08,
    preload: true,
  });
  sound.value.on('error', (error) => console.error(error));
});

onBeforeUnmount(() => {
  sound.value?.destroy();
  sound.value = null;
});
</script>

<template>
  <button type="button" @click="sound?.play()">Play sound</button>
</template>
```

## Browser support

Browsers can block audio until the user interacts with the page. On iOS and Safari, the audio context needs to be resumed inside a user gesture. ClickTone shares one `AudioContext` between instances, requests `latencyHint: 'interactive'`, and installs gesture listeners for `pointerdown`, `pointerup`, `touchstart`, `touchend`, and `keydown`.

After unlocking, the engine plays a silent priming ping. It also handles `visibilitychange` and `pageshow` to resume audio after the page returns. On Safari and iOS, a context may report `running` while its clock is frozen. The engine checks for this state and rebuilds the context on the next user interaction when needed. Buffers are decoded again and gain nodes are reconnected.

When the context is rebuilt, pending requests tied to the old context are cancelled, and started one-shot sounds are stopped. Their `play()` promises resolve without an `end` event. Active loops restart from the beginning on the new context, first trying the URL that last worked; loops started with fallback enabled retain their alternatives. A new play request made by the gesture that triggers recovery can use that new context.

Decoded buffers are cached across instances. Use `preload: true` or `sound.preload()` to load them before the first click. Include an MP3 or AAC source for Safari, where OGG and Opus support varies.

To request an explicit unlock in the browser setup from Quick start:

```ts
document.addEventListener('pointerdown', () => ClickTone.unlock(), { once: true });
```

## Troubleshooting

- If playback is waiting, click or tap the page to unlock audio. Call `stop()` if the pending sound is no longer relevant.
- If an audio URL is on another origin, its server must allow the fetch through CORS. Your Content Security Policy must also allow the URL in `connect-src`.
- An HTTP error, network failure, unsupported codec, or invalid audio file is reported through `error`. A failed load is removed from the cache, so a later `play()` or `preload()` can retry it.
- Format alternatives select a source through `canPlayType`. Set `fallback: true` to try the other URLs after a fetch or decode failure.
- Importing the package without a DOM is supported. Create sounds in the browser lifecycle, as in the Vue example; playback without Web Audio support reports an `error`.

## License

MIT
