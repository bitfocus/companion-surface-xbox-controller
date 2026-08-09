## Xbox Controller

Use a locally connected Xbox controller as a Companion surface.

The following controllers are supported:

- Xbox Series X|S Controller
- Xbox One / Xbox One S Controller
- Xbox Elite Wireless Controller Series 2
- Xbox Adaptive Controller

### Connecting the controller

The controller can be connected either over **USB** or over **Bluetooth**. Bluetooth works the same on
every platform, because the controller behaves as a standard HID gamepad. USB is more involved,
because the controller does not speak HID over the cable — it speaks Microsoft's own protocol, and
Companion can only see it if the operating system republishes it as a HID device:

| Platform | Over USB                                                                       | Over Bluetooth |
| -------- | ------------------------------------------------------------------------------ | -------------- |
| macOS    | Supported, using the driver built into macOS 11 and later                      | Supported      |
| Windows  | Supported, using the driver built into Windows 10 and later                    | Supported      |
| Linux    | Needs the `xpad` kernel driver blacklisted, as it claims the device for itself | Supported      |

If the controller does not appear, click **Rescan USB** on the Surfaces page. Companion only rescans
when a USB device is connected or removed, so a controller that was turned on separately — a
Bluetooth one, in particular — may need a manual rescan.

### Button layout

A controller has no displays, so the grid is only a way of naming things. The rows are grouped by
function rather than shaped like a controller, which makes them much easier to pick out in the list:

|           | col 0 | col 1   | col 2   | col 3    | col 4    | col 5 | col 6 | col 7 |
| --------- | ----- | ------- | ------- | -------- | -------- | ----- | ----- | ----- |
| **row 0** | A     | B       | X       | Y        | LB       | RB    | LT    | RT    |
| **row 1** | D-Up  | D-Down  | D-Left  | D-Right  | View     | Menu  | Xbox  | Share |
| **row 2** | LS Up | LS Down | LS Left | LS Right | LS Click | LS X  | LS Y  |       |
| **row 3** | RS Up | RS Down | RS Left | RS Right | RS Click | RS X  | RS Y  |       |

`LB`/`RB` are the shoulder buttons and `LT`/`RT` the triggers. `LS` and `RS` are the left and right
sticks. `View` and `Menu` are the two small buttons either side of the Xbox button, and `Share` is
the button below them, if your controller has one.

**The Share button only works over Bluetooth.** When the controller is connected by USB, macOS does
not pass it on, so that cell stays inactive. Every other button works over both connections.

### Sticks and triggers

The analog inputs are each available in three different forms, so you can pick whichever suits the
job:

- **As buttons.** The `LS Up`/`LS Down`/`LS Left`/`LS Right` cells act as ordinary buttons that
  press once the stick is pushed far enough, which is handy for nudging a PTZ camera. The `LT` and
  `RT` cells work the same way when the trigger is squeezed.
- **As rotary controls.** The `LS X`, `LS Y`, `RS X` and `RS Y` cells send **rotate** actions
  repeatedly, and the further the stick is pushed the faster they repeat. Good for scrubbing a
  timeline or riding a fader. Pushing right or up sends _rotate-right_, and pushing left or down
  sends _rotate-left_.
- **As variables.** See below.

### Variables

The controller can report the exact position of each stick and trigger into a custom variable of
your choosing. First create the custom variables you want to use on the **Custom Variables** tab —
for example `$(custom:padLeftX)`. Then go to the **Surfaces** page, select the controller, and
choose your variables in the settings panel.

The values reported are:

| Variable      | Range   | Notes                                  |
| ------------- | ------- | -------------------------------------- |
| Left Stick X  | -1 to 1 | Negative is left, positive is right    |
| Left Stick Y  | -1 to 1 | Negative is down, positive is up       |
| Right Stick X | -1 to 1 | Negative is left, positive is right    |
| Right Stick Y | -1 to 1 | Negative is down, positive is up       |
| Left Trigger  | 0 to 1  | 0 when released, 1 when squeezed fully |
| Right Trigger | 0 to 1  | 0 when released, 1 when squeezed fully |

Use an expression if you need a different range. To turn the left stick's X position into a value
from 0 to 100, for instance: `($(custom:padLeftX) + 1) * 50`.

Values are sent at most 20 times a second, and only when they actually change, so a resting
controller generates no traffic.

### Settings

- **Stick deadzone** — movement smaller than this is treated as no movement at all. Raise it if a
  worn stick reports drift when you are not touching it.
- **Press threshold** — how far a stick must be pushed, or a trigger squeezed, before its button
  counts as pressed. Release happens a little below this value so that holding a stick near the
  threshold does not make the button chatter.
- **Max rotation rate** — how many rotate actions per second the stick rotary controls send when the
  stick is pushed all the way.

### Notes

- The Xbox button (the one in the middle) is reported like any other button, but be aware that some
  operating systems also act on it themselves.
- Companion tries to claim the controller exclusively so that other software on the machine does not
  react to the same button presses. Where the operating system does not allow that, it shares the
  controller instead, and other applications may also see your input.
- Controllers that do not report a serial number cannot be told apart from each other. If you use
  two identical controllers, Companion gives them numbered names, and which one gets which name may
  change between restarts.
