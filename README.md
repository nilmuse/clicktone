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
| `pitchVariation` | `number` | `0` | Random playback-rate variation, from `0` to `1`, so repeated clicks do not sound identical. |
| `preload` | `boolean` | `false` | Fetch and decode the sound when the instance is created. |
| `loop` | `boolean` | `false` | Keep playing until `stop()` is called. |
| `replay` | `ReplayBehavior` | `'overlap'` | What happens when this instance is already playing; see Replay behavior. |
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

For an `HTMLAudioElement`, its child `<source>` elements form the fallback list. `{ id }` refers to an audio or source element by its DOM id. For a list, ClickTone prefers a format that `canPlayType` reports as playable; if none is recognized, it uses the first source.

### Methods

The following methods belong to the `sound` instance from Quick start:

| Method | Returns | Description |
| --- | --- | --- |
| `play(input?)` | `Promise<void>` | Play the configured sound, a different `SoundInput`, or a `PlayOptions` object. Resolves when non-looped playback ends or when a loop starts. |
| `preload()` | `Promise<AudioBuffer \| undefined>` | Fetch and decode the configured sound. Returns `undefined` when no buffer is available or loading fails. |
| `stop()` | `void` | Stop all active playback on this instance. |
| `unlock()` | `void` | Resume the shared audio context. Call inside a user gesture. |
| `setVolume(value)` | `void` | Set playback volume from `0` to `1`. |
| `setMuted(muted)` | `void` | Set the muted state. |
| `toggleMuted()` | `boolean` | Toggle muting and return the new muted state. |
| `on(type, listener)` | `() => void` | Subscribe to an event and return an unsubscribe function. The listener receives the event detail. |
| `once(type, listener)` | `void` | Subscribe to the next occurrence of an event. The listener receives the event detail. |
| `destroy()` | `void` | Stop playback and release this instance's audio resources and lifecycle listeners. |

Read the current state through `sound.playing`, `sound.volume`, and `sound.muted`.

`ClickTone.unlock()` resumes the shared context from a global gesture handler. `ClickTone.unlocked` reports whether it has been unlocked.

A `PlayOptions` object can override `src`, `loop`, and `replay` for one call. For example, continuing with the `sound` instance above and an audio file at `/audio/win.mp3`:

```ts
await sound.play({ src: '/audio/win.mp3', replay: 'interrupt' });
```

Loading, decoding, and playback errors are reported through the `error` event. Listen for that event even when awaiting `play()` or `preload()`.

### Events

`ClickTone` extends `EventTarget`. Use the typed `on()` and `once()` helpers, or native `addEventListener`. Native listeners receive a `CustomEvent` with the payload in `event.detail`.

| Event | When | Payload |
| --- | --- | --- |
| `play` | A buffer source starts. | None |
| `end` | Playback finishes naturally. | None |
| `stop` | Active playback is stopped explicitly. | None |
| `unlock` | The shared audio context becomes playable. | None |
| `load` | `preload()` fetches and decodes a source. | `AudioBuffer` |
| `error` | Loading, decoding, or playback fails. | `Error` |

Continuing with `sound` from Quick start:

```ts
const off = sound.on('end', () => console.log('finished'));
sound.once('unlock', () => console.log('audio unlocked'));

// When this subscription is no longer needed:
off();
```

## Replay behavior

- `'overlap'` (default): every accepted `play()` call starts another buffer source.
- `'interrupt'`: stop active playback, then play the requested sound.
- `'ignore-if-playing'`: ignore the request while this instance is playing.
- `'restart'`: stop active playback and start again, bypassing `throttle`.

For looped playback, `play()` resolves once the loop starts. Call `stop()` to end it.

## Provide format alternatives

In the same browser setup as Quick start, supply your audio files in more than one format:

```ts
const fallbackSound = new ClickTone({
  src: ['/audio/click.aac', '/audio/click.ogg', '/audio/click.mp3'],
});
```

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

Decoded buffers are cached across instances. Use `preload: true` or `sound.preload()` to load them before the first click. Include an MP3 or AAC source for Safari, where OGG and Opus support varies.

To request an explicit unlock in the browser setup from Quick start:

```ts
document.addEventListener('pointerdown', () => ClickTone.unlock(), { once: true });
```

## License

MIT
