# companion-surface-xbox-controller

See [HELP.md](./companion/HELP.md) and [LICENSE](./LICENSE)

## Getting started

Executing a `yarn` command should perform all necessary steps to develop the module, if it does not then follow the steps below.

The module can be built once with `yarn build`. This should be enough to get the module to be loadable by companion.

While developing the module, by using `yarn dev` the compiler will be run in watch mode to recompile the files on change.

## Development tools

Two scripts help with the awkward part of a surface module, which is that the hardware is not always to hand:

- `yarn probe` lists gamepad-like HID devices on this machine. Add `--open` to open one and dump its
  input reports, highlighting the bytes that change as you press things. This is how the byte offsets
  in [`src/report.ts`](./src/report.ts) were established, and how to add support for a new controller.
- `yarn decode` opens the controller and prints each frame as the module understands it, so you can
  check that a button is mapped to the name you expect.
- `yarn simulate` feeds synthetic reports through the surface and checks the events it emits, covering
  the press thresholds, hysteresis, rotary repeat rates and variable coalescing. No controller needed.

Note that Xbox controllers do not speak HID over the cable. They speak Microsoft's GIP protocol, and
the operating system hands those frames over as HID reports — so a frame starts with a GIP command
byte, the d-pad is part of the button bitfield rather than a hat switch, and the sticks are signed
16-bit values centred on zero. See [`src/report.ts`](./src/report.ts).

The list of supported controllers lives in [`src/products.ts`](./src/products.ts) and is the single
source of truth — `yarn build` regenerates the `usbIds` in `companion/manifest.json` from it. Those
ids matter, because Companion only offers the module HID devices that match them.
